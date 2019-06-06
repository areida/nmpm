const bandcamp = require('bandcamp-scraper');
const commandLineArgs = require('command-line-args');
const logSymbols = require('log-symbols');
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
    name: 'ignore',
    alias: 'i',
    type: String,
    multiple: true,
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
  console.log(error);
  if (error) {
    console.error(error.response ? error.response.body : error);
  }
}

async function execute() {
  let { auth, dates, genre, ignore, playlist } = options;

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

    console.log(`Created new spotify playlist: ${newPlaylist.external_urls.spotify}`);
  }

  let page = 0;

  // Fetch all the albums for the month
  let { albums, total } = await metalArchivesClient.fetchAlbums(dates[0], genre, page);
  while (albums.length < total) {
    const response = await metalArchivesClient.fetchAlbums(dates[0], genre, ++page);
    albums.push(...response.albums);
  }

  // Filter albums for the desired dates
  albums = albums.filter(({ date }) => dates.indexOf(date) !== -1);

  // Download list of all tracks in playlist
  const tracks = await spotifyClient.getPlaylistTracks(playlist);

  let spotifyTotal = 0;
  let bandcampTotal = 0;

  // Look up albums on spotify and add to playlist if found
  for (let i = 0; i < albums.length; ++i) {
    const { album, artist, artistUrl } = albums[i];

    if (ignore && ignore.indexOf(artist) !== -1) continue;

    try {
      const spotifyHits = await spotifyClient.search(
        `artist:${artist.toLowerCase()} album:${album.toLowerCase()}`,
        'album'
      );

      const symbol = spotifyHits.length ? logSymbols.success : logSymbols.error;

      console.log(symbol, `${artist} - ${album}`);
      console.log(`  - ${artistUrl}`);

      spotifyTotal += spotifyHits.length;

      for (let j = 0; j < spotifyHits.length; ++j) {
        await spotifyClient.addAlbumToPlaylist(spotifyHits[j].id, playlist, tracks);
      }
    } catch (ex) {
      handleError(ex);
    }

    try {
      let bandcampHits = await bandcampSearch({ query: album });

      bandcampHits = bandcampHits.filter(
        hit =>
          hit.type === 'album' &&
          hit.artist.toLowerCase() === artist.toLowerCase() &&
          hit.name.toLowerCase() === album.toLowerCase()
      );

      bandcampHits.forEach(({ url }) => console.log(`  -- ${url}`));

      bandcampTotal += bandcampHits.length;
    } catch (ex) {
      handleError(ex);
    }

    console.log('\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n');

  console.log(`Found ${spotifyTotal} albums on spotify`);
  console.log(`Found ${bandcampTotal} albums on bandcamp`);

  process.exit(0);
}

execute();
