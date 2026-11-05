// Prices, liquidity, dividends and moving averages from Yahoo Finance's public v8 chart endpoint.
// (The old v7 /finance/download endpoint now requires an authenticated session.)
const axios = require('axios');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getChart(ticker, attempt = 1) {
    try {
        const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA`, {
            params: { range: '1y', interval: '1d', events: 'div' },
            timeout: 15 * 1000
        });
        return data.chart.result && data.chart.result[0];
    } catch (e) {
        const status = e.response && e.response.status;
        if (status === 404) return null;
        if (attempt < 4 && (status === 429 || status >= 500 || !status)) {
            await sleep(2000 * attempt);
            return getChart(ticker, attempt + 1);
        }
        throw e;
    }
}

const average = values => values.reduce((sum, v) => sum + v, 0) / values.length;

const movingAverage = (closes, period) =>
    closes.length < period ? null : average(closes.slice(-period));

async function getMarketData(ticker, now = Date.now()) {
    const chart = await getChart(ticker);
    if (!chart || !chart.timestamp) return null;

    const q = chart.indicators.quote[0];
    const quotes = chart.timestamp
        .map((ts, i) => ({ ts, close: q.close[i], volume: q.volume[i] || 0 }))
        .filter(x => x.close != null);
    if (quotes.length === 0) return null;

    // Skip tickers that haven't traded in the last 30 days.
    const lastTrade = (chart.meta.regularMarketTime || quotes[quotes.length - 1].ts) * 1000;
    if (now - lastTrade > 30 * 24 * 3600 * 1000) return null;

    const price = chart.meta.regularMarketPrice || quotes[quotes.length - 1].close;
    const closes = quotes.map(x => x.close);
    const lastThreeMonths = quotes.slice(-63);
    const oneYearAgo = now / 1000 - 365 * 24 * 3600;
    const dividends = Object.values((chart.events && chart.events.dividends) || {})
        .filter(d => d.date >= oneYearAgo)
        .reduce((sum, d) => sum + d.amount, 0);

    return {
        price,
        liquidezMediaDiaria: average(lastThreeMonths.map(x => x.close * x.volume)),
        dividendos12m: dividends,
        MA5: movingAverage(closes, 5),
        MA10: movingAverage(closes, 10),
        MA20: movingAverage(closes, 20),
        MMA50: movingAverage(closes, 50),
        MA100: movingAverage(closes, 100),
        MA200: movingAverage(closes, 200),
    };
}

module.exports = { getMarketData };
