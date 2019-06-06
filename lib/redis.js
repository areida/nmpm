const Redis = require('ioredis');

module.exports = new Redis({ host: process.env.REDIS_HOST, port: 6379 }, { keyPrefix: 'nmpm:' });
