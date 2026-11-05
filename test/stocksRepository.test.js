const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createStocksRepository, isValidDataset } = require('../src/repository/stocksRepository');
const { createLogger } = require('../src/lib/logger');
const { dataset, stock } = require('./helpers');

const logger = createLogger('silent');
const OLD = dataset([stock({ Ativo: 'OLD3' })], '2026-11-01T00:00:00.000Z');
const NEW = dataset([stock({ Ativo: 'NEW3' })], '2026-11-05T00:00:00.000Z');

function repo({ fetchJson, clock = { t: 0 }, ttlMs = 1000 } = {}) {
    return createStocksRepository({ url: 'http://data', ttlMs, fallback: OLD, fetchJson, now: () => clock.t, logger });
}

describe('isValidDataset', () => {
    test('validates the dataset shape', () => {
        assert.equal(isValidDataset(NEW), true);
        assert.equal(isValidDataset(null), false);
        assert.equal(isValidDataset({ updatedAt: 'nope', stocks: [stock()] }), false);
        assert.equal(isValidDataset({ updatedAt: NEW.updatedAt, stocks: [] }), false);
        assert.equal(isValidDataset({ updatedAt: NEW.updatedAt, stocks: [{}] }), false);
    });
});

describe('createStocksRepository', () => {
    test('rejects an invalid fallback', () => {
        assert.throws(() => createStocksRepository({ url: 'x', ttlMs: 1, fallback: {}, logger }), /invalid fallback/);
    });

    test('serves the remote dataset when it is newer', async () => {
        const r = repo({ fetchJson: async () => NEW });
        assert.equal((await r.getDataset()).stocks[0].Ativo, 'NEW3');
    });

    test('keeps the fallback when the remote fails, is invalid or older', async () => {
        for (const fetchJson of [
            async () => { throw new Error('offline'); },
            async () => ({ broken: true }),
            async () => dataset([stock()], '2020-01-01T00:00:00.000Z'),
        ]) {
            assert.equal((await repo({ fetchJson }).getDataset()).stocks[0].Ativo, 'OLD3');
        }
    });

    test('caches for ttlMs and keeps the last good data after a later failure', async () => {
        const clock = { t: 0 };
        let calls = 0;
        const r = repo({ clock, fetchJson: async () => { calls++; if (calls > 1) throw new Error('down'); return NEW; } });

        await r.getDataset();
        clock.t = 500;
        await r.getDataset();
        assert.equal(calls, 1);

        clock.t = 1500;
        assert.equal((await r.getDataset()).stocks[0].Ativo, 'NEW3');
        assert.equal(calls, 2);
    });

    test('concurrent requests share a single fetch', async () => {
        let calls = 0;
        const r = repo({ fetchJson: async () => { calls++; await new Promise(res => setTimeout(res, 10)); return NEW; } });
        await Promise.all([r.getDataset(), r.getDataset(), r.getDataset()]);
        assert.equal(calls, 1);
    });
});
