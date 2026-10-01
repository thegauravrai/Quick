const { createClient } = require('redis');

const redisClient = createClient({
  url: 'rediss://default:gQAAAAAABO8LAAIgcDFlNWYyZGQ0M2M5NTg0ZjE2Yjk1MjdmODBmMDJjN2ZjOA@informed-boar-323339.upstash.io:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Cache connected successfully.'));

redisClient.connect().catch(console.error);

module.exports = redisClient;