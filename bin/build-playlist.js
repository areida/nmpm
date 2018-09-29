const commandLineArgs = require('command-line-args');
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
    name: 'dates',
    alias: 'd',
    type: String,
    multiple: true,
    defaultOption: true,
    defaultValue: [format(new Date(), 'YYYY-MM-DD')],
  },
  {
    name: 'genre',
    alias: 'g',
    type: String,
  },
  {
    name: 'playlist',
    alias: 'p',
    type: String,
  },
]);

console.log(options);

function handleError(message, error) {
  console.error('Error: %s', message);
  if (error) {
    console.error(error.response ? error.response.body : error);
  }
  process.exit(1);
}

async function execute() {
  let { auth, dates, genre, playlist } = options;

  if (!auth) {
    auth = await redis.get('auth-token');
  }

  if (!auth) {
    return handleError('Missing auth token');
  }

  const spotifyClient = new SpotifyApiClient(auth, handleError);
  const metalArchivesClient = new MetalArchivesApiClient(handleError);

  // Create a new playlist if one is not provided
  if (!playlist) {
    const name = ['Metal'];
    if (options.genre) {
      name.push(`- ${genre}`);
    }
    name.push(`- ${dates[0]}`);

    const user = await spotifyClient.getUser();
    const newPlaylist = await spotifyClient.createPlaylist(user.id, name.join(' '));

    playlist = newPlaylist.id;
  }

  let page = 0;
  let processed = 0;

  // Fetch all the albums for the month
  let { albums, total } = await metalArchivesClient.fetchAlbums(dates[0], genre, page);
  while (albums.length < total) {
    const response = await metalArchivesClient.fetchAlbums(dates[0], genre, ++page);
    albums.push(...response.albums);
  }

  // Filter albums for the desired dates
  albums = albums.filter(({ date }) => dates.indexOf(date) !== -1);

  // Look up albums on spotify and add to playlist if found
  for (let i = 0; i < albums.length; ++i) {
    console.log(`Searching for ${albums[i].artist} - ${albums[i].album}`);
    const hits = await spotifyClient.search(
      `artist:${albums[i].artist.toLowerCase()} album:${albums[i].album.toLowerCase()}`,
      'album'
    );

    console.log(
      `Found ${hits.length} album${hits.length !== 1 ? 's' : ''}, ${hits.length ? 'adding to playlist' : 'moving on'}`
    );
    for (let j = 0; j < hits.length; ++j) {
      await spotifyClient.addAlbumToPlaylist(hits[j].id, playlist);
    }
  }

  process.exit(0);
}

execute();
