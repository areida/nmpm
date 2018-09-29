const commandLineArgs = require('command-line-args');
const crypto = require('crypto');
const { format } = require('date-fns');

const MetalArchivesApiClient = require('../lib/metal-archives-api-client');
const SpotifyApiClient = require('../lib/spotify-api-client');
const redis = require('../lib/redis');

const options = commandLineArgs([
  {
    name: 'auth',
    alias: 'a',
    type: String,
  },
  {
    name: 'month',
    alias: 'm',
    type: String,
    defaultOption: true,
    defaultValue: format(new Date(), 'YYYY-MM'),
  },
]);

const handleError = (message, error) => {
  console.error('Error: %s', message);
  if (error) {
    console.error(error.response ? error.response.body : error);
  }
  process.exit(1);
};

const slugify = input => input.trim().toLowerCase().replace(/[^a-zA-Z\d\s]/g, '').replace(/\s/g, '-');

async function execute() {
  let { auth, month } = options;

  if (!auth) {
    auth = await redis.get('auth-token');
  }

  if (!auth) {
    return handleError('Missing auth token');
  }

  const metalArchivesClient = new MetalArchivesApiClient(handleError);
  const spotifyApiClient = new SpotifyApiClient(auth, handleError);

  await redis.del(month);
  const keys = await redis.keys(`${month:*}`);

  for (let i = 0; i < keys.length; ++i) {
    await redis.del(keys[i];
  }

  let page = 0;
  let { albums, total } = await metalArchivesClient.fetchAlbums(month, undefined, page);
  while (albums.length < total) {
    const results = await metalArchivesClient.fetchAlbums(month, undefined, ++page);
    albums.push(...results.albums);
  }

  for (let i = 0; i < albums.length; ++i) {
    let key = `${month}:${slugify(albums[i].artist)}:${slugify(albums[i].album)}`;
    const exists = await redis.exists(key);

    if (exists) {
      key = `${key}:${crypto.randomBytes(3).toString('hex')}`
    }
    console.log(i + 1, key);

    const spotifyAlbums = await spotifyApiClient.search(
      `artist:${albums[i].artist.toLowerCase()} album:${albums[i].album.toLowerCase()}`,
      'album'
    );

    albums[i].spotifyUris = [];
    for (let j = 0; j < spotifyAlbums.length; ++j) {
      albums[i].spotifyUris.push(spotifyAlbums[j].id);
    }

    await redis.hmset(key, albums[i]);
    await redis.lpush(month, key);
  }

  process.exit(0);
}

execute();
