const bandcamp = require('bandcamp-scraper');
const { promisify } = require('util');
const bandcampSearch = promisify(bandcamp.search);

const MetalArchivesApiClient = require('../../lib/metal-archives-api-client');
const SpotifyApiClient = require('../../lib/spotify-api-client');
const redis = require('../../lib/redis');

module.exports = {
  async createPlaylist(dates, genre, auth) {
    const name = ['Metal'];

    const spotifyClient = new SpotifyApiClient(auth);

    if (genre && genre !== '*') {
      name.push(genre);
    }

    name.push(dates[0]);

    const user = await spotifyClient.getUser();

    return await spotifyClient.createPlaylist(user.id, name.join(' - '));
  },

  async getPlaylist(playlist, auth) {
    const spotifyClient = new SpotifyApiClient(auth);

    return spotifyClient.getPlaylist(playlist);
  },

  async execute(options) {
    const { auth, dates, fingerprint, genre, ignore, key, playlist } = options;

    await redis.set(`build-key:${fingerprint}`, key);

    const spotifyClient = new SpotifyApiClient(auth);
    const metalArchivesClient = new MetalArchivesApiClient();

    let page = 0;

    // Fetch all the albums for the month
    let { albums, total } = await metalArchivesClient.fetchAlbums(dates[0], genre || '*', page);
    while (albums.length < total) {
      const response = await metalArchivesClient.fetchAlbums(dates[0], genre || '*', ++page);
      albums.push(...response.albums);
    }

    // Filter albums for the desired dates
    albums = albums.filter(({ date }) => dates.indexOf(date) !== -1);

    // Download list of all tracks in playlist
    const playlistTracks = await spotifyClient.getPlaylistTracks(playlist);

    let spotifyTotal = 0;
    let bandcampTotal = 0;
    const entries = [];
    const spotifyEntries = [];
    const bandcampEntries = [];

    // Look up albums on spotify and add to playlist if found
    for (let i = 0; i < albums.length; ++i) {
      const { album, albumUrl, artist, artistUrl } = albums[i];

      if (ignore && ignore.indexOf(artist) !== -1) continue;

      let entry = {
        album: album,
        albumUrl: albumUrl,
        artist: artist,
        artistUrl: artistUrl,
        bandcamp: false,
        bandcampHits: [],
        genre: albums[i].genre,
        spotify: false,
        spotifyHits: [],
      };

      const spotifyHits = await spotifyClient.search(
        `artist:${artist.toLowerCase()} album:${album.toLowerCase()}`,
        'album'
      );

      entry.spotify = Boolean(spotifyHits.length);

      spotifyTotal += spotifyHits.length;

      for (let j = 0; j < spotifyHits.length; ++j) {
        const tracks = await spotifyClient.getTracks(spotifyHits[j].id);
        const uris = [];

        tracks.forEach(({ id, uri }) => {
          if (playlistTracks.indexOf(id) === -1) {
            uris.push(uri);
          }
        });

        spotifyHits[j].tracks = tracks;

        await spotifyClient.addTracksToPlaylist(uris, playlist);
      }

      entry.spotifyHits = spotifyHits;

      if (entry.spotify) {
        spotifyEntries.push(entry);
      }

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

      if (entry.bandcamp && !entry.spotify) {
        bandcampEntries.push(entry);
      }

      entries.push(entry);

      await redis.hset(`build:${fingerprint}:${key}`, 'entries', JSON.stringify(entries));
      await redis.hset(`build:${fingerprint}:${key}`, 'spotifyEntries', JSON.stringify(spotifyEntries));
      await redis.hset(`build:${fingerprint}:${key}`, 'spotifyTotal', spotifyTotal);
      await redis.hset(`build:${fingerprint}:${key}`, 'bandcampEntries', JSON.stringify(bandcampEntries));
      await redis.hset(`build:${fingerprint}:${key}`, 'bandcampTotal', bandcampTotal);

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await redis.del(`build-key:${fingerprint}`);
  },
};
