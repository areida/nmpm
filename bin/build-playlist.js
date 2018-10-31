const bandcamp = require('bandcamp-scraper');
const commandLineArgs = require('command-line-args');
const { format } = require('date-fns');
const { promisify } = require('util');
const bandcampSearch = promisify(bandcamp.search);

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
    let hits = await spotifyClient.search(
      `artist:${albums[i].artist.toLowerCase()} album:${albums[i].album.toLowerCase()}`,
      'album'
    );

    if (hits.length) {
      console.log(
        `Found ${hits.length} matching album${hits.length !== 1 ? 's' : ''} on spotify, adding to playlist`
      );
    } else {
      console.log('Found 0 matching albums on spotify, moving on');
    }

    for (let j = 0; j < hits.length; ++j) {
      await spotifyClient.addAlbumToPlaylist(hits[j].id, playlist);
    }

    hits = await bandcampSearch({ query: albums[i].album });
    hits = hits.filter(
      ({ artist, name, type }) => type === 'album' &&
      artist.toLowerCase() === albums[i].artist.toLowerCase() &&
      name.toLowerCase() === albums[i].album.toLowerCase()
    );

    if (hits.length) {
      console.log(`Found ${hits.length} matching album${hits.length !== 1 ? 's' : ''} on bandcamp:`);
      for (let i = 0; i< hits.length; ++i) {
        console.log(`\t${hits[i].url}`);
      }
    } else {
      console.log('Found 0 matching albums on bandcamp, moving on');
    }
    console.log('\n');
  }

  process.exit(0);
}

execute();
