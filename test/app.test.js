const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/lib/logger');
const { dataset, stock } = require('./helpers');

const logger = createLogger('silent');
const DATA = dataset([
    stock({ Ativo: 'BBB3', Empresa: 'B', 'EV/EBIT': 4, ROIC: 50 }),
    stock({ Ativo: 'AAA3', Empresa: 'A', 'EV/EBIT': 2, 'Dividend Yield': 12, 'DY Médio 5 Anos': 12, ROIC: 5 }),
    stock({ Ativo: 'LOW3', Empresa: 'LOW', 'Dividend Yield': 3 }),
]);

async function serve(app) {
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
}

describe('HTTP API', () => {
    let ctx;
    let failing;
    before(async () => {
        const stocksRepository = {
            getDataset: async () => { if (failing) throw new Error('secret internals'); return DATA; },
        };
        const now = () => Date.parse(DATA.updatedAt) + 1000;
        ctx = await serve(createApp({ stocksRepository, logger, staleAfterMs: 60_000, now }));
    });
    after(() => ctx.server.close());

    test('GET /api/ibovespa/all returns every stock with data headers', async () => {
        const res = await fetch(`${ctx.base}/api/ibovespa/all`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-data-updated-at'), DATA.updatedAt);
        assert.match(res.headers.get('access-control-expose-headers'), /X-Data-Updated-At/);
        assert.match(res.headers.get('cache-control'), /s-maxage/);
        assert.equal(res.headers.get('x-powered-by'), null);
        assert.equal((await res.json()).length, 3);
    });

    test('GET /api/ibovespa/filtered returns the ranking', async () => {
        const body = await (await fetch(`${ctx.base}/api/ibovespa/filtered`)).json();
        assert.deepEqual(body.map(s => [s.Ranking, s.Ativo]), [[1, 'AAA3'], [2, 'BBB3']]);
    });

    test('filtered accepts limit and minDy', async () => {
        const limited = await (await fetch(`${ctx.base}/api/ibovespa/filtered?limit=1`)).json();
        assert.deepEqual(limited.map(s => s.Ativo), ['AAA3']);
        const highDy = await (await fetch(`${ctx.base}/api/ibovespa/filtered?minDy=10`)).json();
        assert.deepEqual(highDy.map(s => s.Ativo), ['AAA3']);
    });

    test('filtered can sort by the magic formula', async () => {
        const body = await (await fetch(`${ctx.base}/api/ibovespa/filtered?sort=magicFormula`)).json();
        // AAA3: ev 0 + roic 1 = 1; BBB3: ev 1 + roic 0 = 1 -> tie broken by EV/EBIT
        assert.deepEqual(body.map(s => s.Ativo), ['AAA3', 'BBB3']);
    });

    test('filtered accepts a strategy', async () => {
        const res = await fetch(`${ctx.base}/api/ibovespa/filtered?strategy=qualidade`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), []); // the fixtures have no ROCE
    });

    test('invalid query params return 400 with a message', async () => {
        for (const qs of ['limit=0', 'limit=abc', 'limit=1.5', 'limit=1000', 'limit=501', 'minDy=-1', 'sort=price', 'strategy=x']) {
            const res = await fetch(`${ctx.base}/api/ibovespa/filtered?${qs}`);
            assert.equal(res.status, 400, qs);
            assert.match((await res.json()).error, /inválido/);
        }
    });

    test('GET /api/health reports data freshness', async () => {
        const body = await (await fetch(`${ctx.base}/api/health`)).json();
        assert.deepEqual(body, { status: 'ok', dataUpdatedAt: DATA.updatedAt, stocks: 3 });
    });

    test('unknown routes return a JSON 404', async () => {
        const res = await fetch(`${ctx.base}/nope`);
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'Rota não encontrada.' });
    });

    test('internal errors return 500 without leaking details', async () => {
        failing = true;
        try {
            const res = await fetch(`${ctx.base}/api/ibovespa/filtered`);
            assert.equal(res.status, 500);
            const body = await res.json();
            assert.equal(body.error, 'Erro interno ao processar a requisição.');
            assert.doesNotMatch(JSON.stringify(body), /secret/);
        } finally {
            failing = false;
        }
    });

    test('health reports stale data', async () => {
        const app = createApp({
            stocksRepository: { getDataset: async () => DATA },
            logger,
            staleAfterMs: 1000,
            now: () => Date.parse(DATA.updatedAt) + 5000,
        });
        const { server, base } = await serve(app);
        try {
            assert.equal((await (await fetch(`${base}/api/health`)).json()).status, 'stale');
        } finally {
            server.close();
        }
    });
});

describe('GET /api/backtest', () => {
    const { isValidBacktest } = require('../src/routes/backtest');
    const BACKTEST = { updatedAt: '2026-11-08T00:00:00.000Z', periodos: [{ id: 'completo', estrategias: {}, benchmarks: {} }] };

    test('serves the backtest dataset', async () => {
        const stocksRepository = { getDataset: async () => DATA };
        const backtestRepository = { getDataset: async () => BACKTEST };
        const ctx = await serve(createApp({ stocksRepository, backtestRepository, logger }));
        try {
            const res = await fetch(`${ctx.base}/api/backtest`);
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('x-data-updated-at'), BACKTEST.updatedAt);
            assert.deepEqual(await res.json(), BACKTEST);
        } finally {
            ctx.server.close();
        }
    });

    test('validates the dataset shape', () => {
        assert.equal(isValidBacktest(BACKTEST), true);
        assert.equal(isValidBacktest({ updatedAt: 'x', periodos: [] }), false);
        assert.equal(isValidBacktest(null), false);
    });
});

describe('GET /api/ibovespa/premissas', () => {
    const PREMISSAS = { tesouro: { titulo: 'Tesouro IPCA+ com Juros Semestrais 2037', taxa: 7.7 }, ipca: { taxa: 4.9 }, retornoExigido: 12.6, crescimentoPerpetuidade: 3, taxaFinal: 9.6 };

    test('serves the intrinsic value assumptions, or 404 when missing', async () => {
        let data = { ...DATA, premissas: PREMISSAS };
        const ctx = await serve(createApp({ stocksRepository: { getDataset: async () => data }, logger }));
        try {
            let res = await fetch(`${ctx.base}/api/ibovespa/premissas`);
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), PREMISSAS);
            data = DATA;
            res = await fetch(`${ctx.base}/api/ibovespa/premissas`);
            assert.equal(res.status, 404);
        } finally {
            ctx.server.close();
        }
    });
});
