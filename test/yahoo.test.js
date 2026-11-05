const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseChart, fetchChart } = require('../src/sources/yahoo');

const DAY = 24 * 60 * 60;
const NOW_S = Date.UTC(2026, 10, 5) / 1000;

// `days` daily candles ending today, close = 1, 2, 3, ... and volume = 100.
function chart({ days = 250, dividends = {}, meta = {}, endS = NOW_S } = {}) {
    const timestamp = Array.from({ length: days }, (_, i) => endS - (days - 1 - i) * DAY);
    return {
        meta: { regularMarketPrice: days, regularMarketTime: endS, ...meta },
        timestamp,
        events: { dividends },
        indicators: { quote: [{ close: timestamp.map((_, i) => i + 1), volume: timestamp.map(() => 100) }] },
    };
}

describe('parseChart', () => {
    test('computes price, moving averages and liquidity', () => {
        const m = parseChart(chart(), NOW_S * 1000);
        assert.equal(m.price, 250);
        assert.equal(m.MA5, (246 + 247 + 248 + 249 + 250) / 5);
        assert.equal(m.MA200, (51 + 250) / 2);
        // last 63 closes are 188..250, times volume 100
        assert.equal(m.liquidezMediaDiaria, ((188 + 250) / 2) * 100);
    });

    test('moving averages are null without enough history', () => {
        const m = parseChart(chart({ days: 30 }), NOW_S * 1000);
        assert.equal(m.MA20, 20.5 - 10 + 10); // closes 11..30
        assert.equal(m.MMA50, null);
        assert.equal(m.MA200, null);
    });

    test('sums only dividends paid in the last 12 months', () => {
        const dividends = {
            a: { amount: 0.5, date: NOW_S - 10 * DAY },
            b: { amount: 0.25, date: NOW_S - 300 * DAY },
            c: { amount: 9, date: NOW_S - 400 * DAY },
        };
        assert.equal(parseChart(chart({ dividends }), NOW_S * 1000).dividendos12m, 0.75);
    });

    test('ignores null candles', () => {
        const c = chart({ days: 3 });
        c.indicators.quote[0].close = [1, null, 3];
        c.meta.regularMarketPrice = undefined;
        assert.equal(parseChart(c, NOW_S * 1000).price, 3);
    });

    test('returns null for stale, empty or malformed charts', () => {
        assert.equal(parseChart(chart({ endS: NOW_S - 40 * DAY }), NOW_S * 1000), null);
        assert.equal(parseChart({ timestamp: [], indicators: { quote: [{ close: [] }] } }), null);
        assert.equal(parseChart(null), null);
        assert.equal(parseChart({ meta: {} }), null);
    });
});

describe('fetchChart', () => {
    const noSleep = async () => {};
    const httpError = status => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

    test('requests the .SA symbol and returns the first result', async () => {
        let requested;
        const http = { get: async url => { requested = url; return { data: { chart: { result: [{ ok: 1 }] } } }; } };
        assert.deepEqual(await fetchChart('PETR4', { http, sleep: noSleep }), { ok: 1 });
        assert.match(requested, /\/PETR4\.SA$/);
    });

    test('returns null for unknown tickers', async () => {
        const http = { get: async () => { throw httpError(404); } };
        assert.equal(await fetchChart('XXXX3', { http, sleep: noSleep }), null);
    });

    test('retries rate limits and server errors', async () => {
        let calls = 0;
        const http = {
            get: async () => {
                calls++;
                if (calls < 3) throw httpError(calls === 1 ? 429 : 503);
                return { data: { chart: { result: [{ ok: 1 }] } } };
            },
        };
        assert.deepEqual(await fetchChart('PETR4', { http, sleep: noSleep }), { ok: 1 });
        assert.equal(calls, 3);
    });

    test('gives up after maxAttempts and does not retry client errors', async () => {
        let calls = 0;
        const failing = status => ({ get: async () => { calls++; throw httpError(status); } });
        await assert.rejects(fetchChart('PETR4', { http: failing(500), sleep: noSleep, maxAttempts: 3 }), /HTTP 500/);
        assert.equal(calls, 3);
        calls = 0;
        await assert.rejects(fetchChart('PETR4', { http: failing(401), sleep: noSleep }), /HTTP 401/);
        assert.equal(calls, 1);
    });
});

describe('dividend history', () => {
    test('splits dividends into trailing 12-month windows over 5 years', () => {
        const dividends = {
            a: { amount: 1, date: NOW_S - 30 * DAY },
            b: { amount: 2, date: NOW_S - 400 * DAY },
            c: { amount: 0.5, date: NOW_S - 1000 * DAY },
            d: { amount: 7, date: NOW_S - 6 * 365 * DAY }, // older than 5 years: ignored
        };
        const m = parseChart(chart({ dividends }), NOW_S * 1000);
        assert.equal(m.dividendos12m, 1);
        assert.equal(m.dividendosMedia5a, (1 + 2 + 0.5) / 5);
        assert.equal(m.anosComDividendos, 3);
    });

    test('a company that never paid has zero history', () => {
        const m = parseChart(chart(), NOW_S * 1000);
        assert.equal(m.dividendosMedia5a, 0);
        assert.equal(m.anosComDividendos, 0);
    });
});
