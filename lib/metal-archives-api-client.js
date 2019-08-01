const request = require('request-promise-native');
const striptags = require('striptags');

module.exports = class MetalArchivesApiClient {
  constructor(handleError) {
    this.handleError = handleError || console.error;
  }

  async fetchAlbums(date, genre, page = 0) {
    try {
      const { aaData, iTotalRecords } = await request({
        uri: 'https://www.metal-archives.com/search/ajax-advanced/searching/albums',
        qs: {
          genre: genre || '*',
          iDisplayStart: page * 200,
          iDisplayLength: 200,
          releaseMonthFrom: date.substring(5, 7),
          releaseMonthTo: date.substring(5, 7),
          releaseType: [1, 3, 5],
          releaseYearFrom: date.substring(0, 4),
          releaseYearTo: date.substring(0, 4),
        },
        json: true,
      });

      return {
        albums: aaData.map(values => {
          const dateString = values[values.length - 1];

          return {
            album: striptags(values[1]).trim(),
            albumUrl: values[1].match(/href="(.*?)"/)[1],
            artist: striptags(values[0]).trim(),
            artistUrl: values[0].match(/href="(.*?)"/)[1],
            date: dateString.substring(dateString.length - 14, dateString.length - 4),
            genre: striptags(values[values.length - 2]).trim(),
          };
        }),
        total: iTotalRecords,
      };
    } catch (error) {
      this.handleError('Failed fetching from metal-archives.com', error);
    }
  }
};
