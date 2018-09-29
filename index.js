const express = require('express');
const handlebars = require('express-handlebars');
const url = require('url');
const uuid = require('uuid');

const redis = require('./lib/redis');
const SpotifyApiClient = require('./lib/spotify-api-client');

const app = new express();
const hbs = handlebars.create({ defaultLayout: 'main', extname: '.hbs' });

app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');

const PORT = 9000;

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
    const { access_token, expires_in } = await SpotifyApiClient.authorize(req.query.code);

    await redis.set('auth-token', access_token);
    await redis.expire('auth-token', parseInt(expires_in, 10) - 60);
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

    return res.redirect(SpotifyApiClient.getAuthorizeUrl(nonce));
  }

  const spotifyClient = new SpotifyApiClient(authToken);

  const user = await spotifyClient.getUser();

  return res.render('home', { user });
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
