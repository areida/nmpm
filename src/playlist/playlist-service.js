const bandcamp = require('bandcamp-scraper');
const { promisify } = require('util');
const bandcampSearch = promisify(bandcamp.search);

const MetalArchivesApiClient = require('../../lib/metal-archives-api-client');
const SpotifyApiClient = require('../../lib/spotify-api-client');
const redis = require('../../lib/redis');

module.exports = {
  async execute(options) {
    console.log(options);
    let { auth, dates, genre, ignore, key, playlist } = options;

    if (!auth) {
      auth = await redis.get('auth-token');
    }

    if (!auth) {
      return module.exports.handleError('Missing auth token');
    }

    await redis.set('build-key', key);

    const spotifyClient = new SpotifyApiClient(auth, module.exports.handleError);
    const metalArchivesClient = new MetalArchivesApiClient(module.exports.handleError);

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

      await redis.lpush(key, `Created new Spotify playlist: <a href="${newPlaylist.external_urls.spotify}">${name.join(' ')}`);
      await redis.lpush(key, '<br />');
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
      const { album, albumUrl, artist, artistUrl } = albums[i];

      if (ignore && ignore.indexOf(artist) !== -1) continue;

      try {
        const spotifyHits = await spotifyClient.search(
          `artist:${artist.toLowerCase()} album:${album.toLowerCase()}`,
          'album'
        );

        await redis.lpush(key, `<a href="${artistUrl}">${artist}</a> - <a href="${albumUrl}">${album}</a>`);

        if (spotifyHits.length) {
          await redis.lpush(key, `Found on Spotify`);
        } else {
          await redis.lpush(key, 'Not found on Spotify');
        }

        spotifyTotal += spotifyHits.length;

        for (let j = 0; j < spotifyHits.length; ++j) {
          await spotifyClient.addAlbumToPlaylist(spotifyHits[j].id, playlist, tracks);
        }
      } catch (ex) {
        await redis.del('build-key');
        return module.exports.handleError(ex);
      }

      try {
        let bandcampHits = await bandcampSearch({ query: album });

        bandcampHits = bandcampHits.filter(
          hit => hit.type === 'album' &&
          hit.artist.toLowerCase() === artist.toLowerCase() &&
          hit.name.toLowerCase() === album.toLowerCase()
        );

        if (bandcampHits.length) {
          await redis.lpush(key, `Found on Bandcamp`);
        } else {
          await redis.lpush(key, 'Not found on Bandcamp');
        }

        bandcampHits.forEach(async ({ url }) => {
          await redis.lpush(key, `<a href="${url}">${url}</a>`);
        });

        bandcampTotal += bandcampHits.length;
      } catch (ex) {
        await redis.del('build-key');
        return module.exports.handleError(ex);
      }

      await redis.lpush(key, '<br />');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await redis.lpush(key, `Found ${spotifyTotal} albums on Spotify`);
    await redis.lpush(key, `Found ${bandcampTotal} albums on Bandcamp`);

    await redis.del('build-key');
  },

  async handleError(message) {
    await redis.lpush(key, `Error: ${message}`);
  },
};
