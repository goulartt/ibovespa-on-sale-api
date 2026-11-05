// Prices, liquidity, dividends and moving averages from Yahoo Finance's public v8 chart endpoint.
// (The v7 /finance/download endpoint requires an authenticated session since 2024.)
const axios = require('axios');
const { average } = require('../domain/indicators');
const { sleep: defaultSleep } = require('../lib/concurrency');

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 30 * DAY_MS;
const LIQUIDITY_WINDOW = 63; // ~3 months of trading days
const MOVING_AVERAGES = { MA5: 5, MA10: 10, MA20: 20, MMA50: 50, MA100: 100, MA200: 200 };

const movingAverage = (closes, period) => (closes.length < period ? null : average(closes.slice(-period)));

// Pure: converts a v8 chart result into market data. Returns null for empty or stale tickers.
function parseChart(chart, now = Date.now()) {
    if (!chart || !Array.isArray(chart.timestamp) || !chart.indicators?.quote?.[0]) return null;

    const q = chart.indicators.quote[0];
    const quotes = chart.timestamp
        .map((ts, i) => ({ ts, close: q.close?.[i], volume: q.volume?.[i] || 0 }))
        .filter(x => Number.isFinite(x.close));
    if (quotes.length === 0) return null;

    const last = quotes[quotes.length - 1];
    const lastTradeMs = (chart.meta?.regularMarketTime || last.ts) * 1000;
    if (now - lastTradeMs > STALE_AFTER_MS) return null;

    const price = chart.meta?.regularMarketPrice || last.close;
    const closes = quotes.map(x => x.close);
    const oneYearAgo = (now - 365 * DAY_MS) / 1000;
    const dividendos12m = Object.values(chart.events?.dividends || {})
        .filter(d => d.date >= oneYearAgo && Number.isFinite(d.amount))
        .reduce((sum, d) => sum + d.amount, 0);

    const market = {
        price,
        liquidezMediaDiaria: average(quotes.slice(-LIQUIDITY_WINDOW).map(x => x.close * x.volume)),
        dividendos12m,
    };
    for (const [name, period] of Object.entries(MOVING_AVERAGES)) market[name] = movingAverage(closes, period);
    return market;
}

const isRetryable = status => status === 429 || status >= 500 || status == null;

async function fetchChart(ticker, { http = axios, sleep = defaultSleep, maxAttempts = 4 } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            const { data } = await http.get(`${CHART_URL}/${encodeURIComponent(ticker)}.SA`, {
                params: { range: '1y', interval: '1d', events: 'div' },
                timeout: 15 * 1000,
            });
            return data?.chart?.result?.[0] ?? null;
        } catch (e) {
            const status = e.response?.status;
            if (status === 404) return null;
            if (attempt >= maxAttempts || !isRetryable(status)) throw e;
            await sleep(2000 * attempt);
        }
    }
}

async function getMarketData(ticker, options = {}) {
    return parseChart(await fetchChart(ticker, options), options.now);
}

module.exports = { parseChart, fetchChart, getMarketData, movingAverage };
