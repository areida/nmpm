const bandcamp = require('bandcamp-scraper');
const { promisify } = require('util');
const bandcampSearch = promisify(bandcamp.search);

const MetalArchivesApiClient = require('../../lib/metal-archives-api-client');
const SpotifyApiClient = require('../../lib/spotify-api-client');
const redis = require('../../lib/redis');

module.exports = {
  async createPlaylist(dates, genre) {
    const name = ['Metal'];

    const auth = await redis.get('auth-token');
    const spotifyClient = new SpotifyApiClient(auth);

    if (genre) {
      name.push(genre);
    }

    name.push(dates[0]);

    const user = await spotifyClient.getUser();

    return await spotifyClient.createPlaylist(user.id, name.join(' - '));
  },

  async getPlaylist(playlist) {
    const auth = await redis.get('auth-token');
    const spotifyClient = new SpotifyApiClient(auth);

    return spotifyClient.getPlaylist(playlist);
  },

  async execute(options) {
    const { dates, genre, ignore, key, playlist } = options;

    const auth = await redis.get('auth-token');

    await redis.set('build-key', key);

    const spotifyClient = new SpotifyApiClient(auth);
    const metalArchivesClient = new MetalArchivesApiClient();

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
    const entries = [];

    // Look up albums on spotify and add to playlist if found
    for (let i = 0; i < albums.length; ++i) {
      const { album, albumUrl, artist, artistUrl } = albums[i];

      if (ignore && ignore.indexOf(artist) !== -1) continue;

      let entry = {};

      try {
        const spotifyHits = await spotifyClient.search(
          `artist:${artist.toLowerCase()} album:${album.toLowerCase()}`,
          'album'
        );

        entry.album = album;
        entry.albumUrl = albumUrl;
        entry.artist = artist;
        entry.artistUrl = artistUrl;
        entry.spotify = Boolean(spotifyHits.length);
        entry.spotifyHits = spotifyHits;

        spotifyTotal += spotifyHits.length;

        for (let j = 0; j < spotifyHits.length; ++j) {
          await spotifyClient.addAlbumToPlaylist(spotifyHits[j].id, playlist, tracks);
        }
      } catch (ex) {
        await redis.del('build-key');
      }

      try {
        let bandcampHits = await bandcampSearch({ query: album });

        bandcampHits = bandcampHits.filter(
          hit =>
            hit.type === 'album' &&
            hit.artist.toLowerCase() === artist.toLowerCase() &&
            hit.name.toLowerCase() === album.toLowerCase()
        );

        entry.bandcamp = Boolean(bandcampHits.length);
        entry.bandcampHits = bandcampHits;

        bandcampTotal += bandcampHits.length;
      } catch (ex) {
        await redis.del('build-key');
      }

      entries.push(entry);

      await redis.hset(key, 'entries', JSON.stringify(entries));
      await redis.hset(key, 'spotifyTotal', spotifyTotal);
      await redis.hset(key, 'bandcampTotal', bandcampTotal);

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await redis.del('build-key');
  },
};
