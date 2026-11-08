// Entry point: Vercel imports the exported app; `npm start` runs it as a standalone server.
const config = require('./src/config');
const { createApp } = require('./src/app');
const { createStocksRepository } = require('./src/repository/stocksRepository');
const { logger } = require('./src/lib/logger');
const { isValidBacktest } = require('./src/routes/backtest');
const bundledDataset = require('./data/stocks.json');
const bundledBacktest = require('./data/backtest.json');

const stocksRepository = createStocksRepository({
    url: config.stocksDataUrl,
    ttlMs: config.stocksCacheTtlMs,
    timeoutMs: config.httpTimeoutMs,
    fallback: bundledDataset,
});

const backtestRepository = createStocksRepository({
    url: config.backtestDataUrl,
    ttlMs: config.stocksCacheTtlMs,
    timeoutMs: config.httpTimeoutMs,
    fallback: bundledBacktest,
    isValid: isValidBacktest,
});

const app = createApp({ stocksRepository, backtestRepository, staleAfterMs: config.staleAfterMs });

if (require.main === module) {
    app.listen(config.port, () => logger.info(`Server is running on port ${config.port}`));
}

module.exports = app;
