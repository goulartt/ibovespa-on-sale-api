// Serves the dataset built by scripts/build-data.js (CVM + Yahoo), refreshed daily by GitHub Actions.
// Reads the latest committed data/stocks.json from GitHub so the API picks up new data without a
// redeploy; falls back to the copy bundled with the deployment.
const axios = require('axios');
const bundled = require('./data/stocks.json');

const DATA_URL = process.env.STOCKS_DATA_URL ||
    'https://raw.githubusercontent.com/goulartt/ibovespa-on-sale-api/main/data/stocks.json';
const CACHE_MS = 10 * 60 * 1000;

let cache = { data: bundled, fetchedAt: 0 };

async function getStocks() {
    if (Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
    try {
        const { data } = await axios.get(DATA_URL, { timeout: 5000 });
        if (Array.isArray(data.stocks) && data.stocks.length > 0 && data.updatedAt >= cache.data.updatedAt) {
            cache = { data, fetchedAt: Date.now() };
        } else {
            cache.fetchedAt = Date.now();
        }
    } catch (e) {
        console.log(`could not fetch ${DATA_URL}: ${e.message}; using cached data from ${cache.data.updatedAt}`);
        cache.fetchedAt = Date.now();
    }
    return cache.data;
}

module.exports = { getStocks };
