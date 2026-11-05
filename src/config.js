const toPositiveInt = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
};

const config = Object.freeze({
    port: toPositiveInt(process.env.PORT, 8080),
    // Latest dataset committed by the daily GitHub Actions job (see .github/workflows/update-data.yml).
    stocksDataUrl: process.env.STOCKS_DATA_URL ||
        'https://raw.githubusercontent.com/goulartt/ibovespa-on-sale-api/main/data/stocks.json',
    stocksCacheTtlMs: toPositiveInt(process.env.STOCKS_CACHE_TTL_MS, 10 * 60 * 1000),
    httpTimeoutMs: toPositiveInt(process.env.HTTP_TIMEOUT_MS, 5000),
    // Data older than this is reported as "stale" by /api/health.
    staleAfterMs: toPositiveInt(process.env.STALE_AFTER_MS, 4 * 24 * 60 * 60 * 1000),
});

module.exports = config;
