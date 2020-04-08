const kue = require('kue');

const queue = kue.createQueue({
  prefix: 'q',
  redis: {
    host: process.env.REDIS_HOST,
    port: 6379,
  },
});

kue.app.listen(3000);

module.exports = queue;