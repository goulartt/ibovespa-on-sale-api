// Serves the dataset built by scripts/build-data.js (CVM + Yahoo), refreshed daily by GitHub Actions.
// Reads the latest committed data/stocks.json from GitHub so new data shows up without a redeploy,
// keeps the last good copy in memory and falls back to the copy bundled with the deployment.
const axios = require('axios');
const { logger: defaultLogger } = require('../lib/logger');

function isValidDataset(data) {
    return Boolean(data) &&
        typeof data.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(data.updatedAt)) &&
        Array.isArray(data.stocks) &&
        data.stocks.length > 0 &&
        data.stocks.every(s => s && typeof s.Ativo === 'string');
}

// Also serves other committed datasets (e.g. data/backtest.json) through `isValid`.
function createStocksRepository({
    url,
    isValid = isValidDataset,
    ttlMs,
    fallback,
    fetchJson = (u, timeout) => axios.get(u, { timeout }).then(r => r.data),
    timeoutMs = 5000,
    now = Date.now,
    logger = defaultLogger,
}) {
    if (!isValid(fallback)) throw new Error('stocksRepository: invalid fallback dataset');

    let current = fallback;
    let checkedAt = -Infinity;
    let inFlight = null;

    async function refresh() {
        try {
            const data = await fetchJson(url, timeoutMs);
            if (!isValid(data)) {
                logger.warn(`ignoring invalid dataset from ${url}`);
            } else if (Date.parse(data.updatedAt) >= Date.parse(current.updatedAt)) {
                current = data;
            }
        } catch (e) {
            logger.warn(`could not fetch ${url}: ${e.message}; serving data from ${current.updatedAt}`);
        } finally {
            checkedAt = now();
        }
    }

    return {
        async getDataset() {
            if (now() - checkedAt >= ttlMs) {
                // Concurrent requests share one refresh.
                inFlight = inFlight || refresh().finally(() => { inFlight = null; });
                await inFlight;
            }
            return current;
        },
    };
}

module.exports = { createStocksRepository, isValidDataset };
