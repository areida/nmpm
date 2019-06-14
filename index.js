const express = require('express');
const Handlebars = require('express-handlebars');
const Fingerprint = require('express-fingerprint');
const moment = require('moment-timezone');
const uuid = require('uuid');
const bodyParser = require('body-parser');

const redis = require('./lib/redis');
const SpotifyApiClient = require('./lib/spotify-api-client');
const playlistService = require('./src/playlist/playlist-service');

moment.tz.link('America/Phoenix|US');

const app = new express();
const hbs = Handlebars.create({
  defaultLayout: 'main',
  extname: '.hbs',
  helpers: {
    duration: duration => {
      const seconds = duration / 1000;

      return `${Math.floor(seconds / 60)}:${Math.round(seconds % 60)
        .toString()
        .padStart(2, '0')}`;
    },
  },
});

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');

const PORT = 9000;

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(Fingerprint());

app.get('/authorize', async (req, res) => {
  const fingerprint = req.fingerprint.hash;
  const nonce = await redis.get(`auth-nonce:${fingerprint}`);
  await redis.del(`auth-nonce:${fingerprint}`);

  if (req.query.state !== nonce) {
    return res.status(400).render('error', { error: 'Authorization failed: invalid state' });
  }

  if (req.query.error) {
    return res.status(400).render('error', { error: req.query.error });
  }

  try {
    const { access_token, expires_in, refresh_token } = await SpotifyApiClient.authorize(req.query.code);

    await redis.set(`auth-token:${fingerprint}`, access_token);
    await redis.expire(`auth-token:${fingerprint}`, parseInt(expires_in, 10) - 60);
    await redis.set(`refresh-token:${fingerprint}`, refresh_token);
  } catch (error) {
    return res.status(400).render('error', { error: error.message });
  }

  return res.redirect(process.env.APP_URL);
});

app.get('/:key?', async (req, res) => {
  const fingerprint = req.fingerprint.hash;
  const authToken = await redis.get(`auth-token:${fingerprint}`);

  const { key } = req.params;

  if (!authToken) {
    const nonce = uuid.v4();
    await redis.set(`auth-nonce:${fingerprint}`, nonce);

    const refreshToken = await redis.get(`refresh-token:${fingerprint}`);

    if (refreshToken) {
      const { access_token, expires_in, refresh_token } = await SpotifyApiClient.refresh(refreshToken);

      await redis.set(`auth-token:${fingerprint}`, access_token);
      await redis.expire(`auth-token:${fingerprint}`, parseInt(expires_in, 10) - 60);
      if (refresh_token) {
        await redis.set(`refresh-token:${fingerprint}`, refresh_token);
      }

      return res.redirect(`/${key || ''}`);
    } else {
      return res.redirect(SpotifyApiClient.getAuthorizeUrl(nonce));
    }
  }

  const spotifyClient = new SpotifyApiClient(authToken);

  const user = await spotifyClient.getUser();
  let playlists = await spotifyClient.getPlaylists();

  const today = moment.tz(user.country);

  let log = { empty: true };

  if (key) {
    log = await redis.hgetall(`build:${fingerprint}:${key}`);
    if (log.entries) {
      log.entries = JSON.parse(log.entries);
    } else {
      log.entries = [];
    }
  }

  const buildKey = await redis.get(`build-key:${fingerprint}`);
  playlists = playlists.items.map(list => {
    list.selected = log && list.id === log.playlist;
    return list;
  });

  return res.render('home', {
    days: log.days || 1,
    date: log.date,
    fingerprint,
    genre: log.genre || '',
    ignore: log.ignore || '',
    log,
    maxDays:
      moment(today)
        .endOf('month')
        .diff(today, 'days') + 1,
    newKey: uuid.v4(),
    playlists,
    running: buildKey === key,
    today: today.format('YYYY-MM-DD'),
    user,
  });
});

app.post('/playlist', async (req, res) => {
  const { date, days, fingerprint, genre, key } = req.body;
  let { ignore, playlist } = req.body;

  const auth = await redis.get(`auth-token:${fingerprint}`);

  let dates = new Array(parseInt(days, 10)).fill().map((val, index) =>
    moment(date)
      .add(index, 'days')
      .format('YYYY-MM-DD')
  );

  if (ignore) {
    ignore = ignore.split(',');
  } else {
    ignore = [];
  }

  if (playlist) {
    playlist = await playlistService.getPlaylist(playlist, auth);
  } else {
    playlist = await playlistService.createPlaylist(dates, genre, auth);
  }

  await redis.hmset(`build:${fingerprint}:${key}`, {
    bandcampTotal: 0,
    entries: [],
    date: dates[0],
    days,
    genre,
    ignore: ignore.join(','),
    playlist: playlist.id,
    playlistName: playlist.name,
    playlistUrl: playlist.external_urls.spotify,
    spotifyTotal: 0,
  });

  playlistService.execute({
    auth,
    dates,
    fingerprint,
    genre,
    ignore,
    key,
    playlist: playlist.id,
  });

  return res.status(200);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
