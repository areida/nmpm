const express = require('express');
const handlebars = require('express-handlebars');
const moment = require('moment-timezone');
const uuid = require('uuid');
var bodyParser = require('body-parser');

const redis = require('./lib/redis');
const SpotifyApiClient = require('./lib/spotify-api-client');
const playlistService = require('./src/playlist/playlist-service');

moment.tz.link('America/Phoenix|US');

const app = new express();
const hbs = handlebars.create({ defaultLayout: 'main', extname: '.hbs' });

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');

const PORT = 9000;

app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/authorize', async (req, res) => {
  const nonce = await redis.get('auth-nonce');
  await redis.del('auth-nonce');

  if (req.query.state !== nonce) {
    return res.status(400).render('error', { error: 'Authorization failed: invalid state' });
  }

  if (req.query.error) {
    return res.status(400).render('error', { error: req.query.error });
  }

  try {
    const { access_token, expires_in, refresh_token } = await SpotifyApiClient.authorize(req.query.code);

    await redis.set('auth-token', access_token);
    await redis.expire('auth-token', parseInt(expires_in, 10) - 60);
    await redis.set('refresh-token', refresh_token);
  } catch (error) {
    return res.status(400).render('error', { error: error.message });
  }

  return res.redirect(process.env.APP_URL);
});

app.get('/*', async (req, res) => {
  const authToken = await redis.get('auth-token');

  if (!authToken) {
    const nonce = uuid.v4();
    await redis.set('auth-nonce', nonce);

    const refreshToken = await redis.get('refresh-token');

    if (refreshToken) {
      const { access_token, expires_in, refresh_token } = await SpotifyApiClient.refresh(refreshToken);

      await redis.set('auth-token', access_token);
      await redis.expire('auth-token', parseInt(expires_in, 10) - 60);
      if (refresh_token) {
        await redis.set('refresh-token', refresh_token);
      }

      return res.redirect(req.get('referer'));
    } else {
      return res.redirect(SpotifyApiClient.getAuthorizeUrl(nonce));
    }
  }

  const { key } = req.query;

  const spotifyClient = new SpotifyApiClient(authToken);

  const user = await spotifyClient.getUser();
  const playlists = await spotifyClient.getPlaylists();

  const today = moment.tz(user.country);

  let log;

  if (key) {
    log = await redis.hgetall(key);
    if (log.entries) {
      log.entries = JSON.parse(log.entries);
    } else {
      log.entries = [];
    }
  }

  const buildKey = await redis.get('build-key');

  return res.render('home', {
    playlists: playlists.items.map(list => {
      list.selected = log && list.id === log.playlist;
      return list;
    }),
    today: today.format('YYYY-MM-DD'),
    user,
    newKey: uuid.v4(),
    maxDays:
      moment(today)
        .endOf('month')
        .diff(today, 'days') + 1,
    log,
    running: buildKey === key,
  });
});

app.post('/playlist', async (req, res) => {
  const { date, days, genre, ignore, key } = req.body;
  let { playlist } = req.body;

  let dates = new Array(parseInt(days, 10)).fill().map((val, index) =>
    moment(date)
      .add(index, 'days')
      .format('YYYY-MM-DD')
  );

  if (playlist) {
    playlist = await playlistService.getPlaylist(playlist);
  } else {
    playlist = await playlistService.createPlaylist(dates, genre);
  }

  await redis.hmset(key, {
    entries: [],
    spotifyTotal: 0,
    bandcampTotal: 0,
    playlist: playlist.id,
    playlistName: playlist.name,
    playlistUrl: playlist.external_urls.spotify,
  });

  playlistService.execute({ dates, genre, ignore, key, playlist: playlist.id });

  return res.status(200);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
