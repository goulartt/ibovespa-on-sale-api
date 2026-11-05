const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { rankStocks } = require('../src/domain/ranking');
const { stock } = require('./helpers');

describe('rankStocks', () => {
    test('keeps only liquid, profitable stocks with DY above 6%', () => {
        const stocks = [
            stock({ Ativo: 'OK3', Empresa: 'OK' }),
            stock({ Ativo: 'ILIQ3', Empresa: 'ILIQ', 'Liquidez Média Diária': 1_000_000 }),
            stock({ Ativo: 'LOSS3', Empresa: 'LOSS', 'Margem Ebit': -1 }),
            stock({ Ativo: 'LOWDY3', Empresa: 'LOWDY', 'Dividend Yield': 6 }),
            stock({ Ativo: 'BANK4', Empresa: 'BANK', 'EV/EBIT': null }),
            stock({ Ativo: 'NODY3', Empresa: 'NODY', 'Dividend Yield': null }),
        ];
        assert.deepEqual(rankStocks(stocks).map(s => s.Ativo), ['OK3']);
    });

    test('excludes companies in judicial recovery', () => {
        const stocks = [stock({ Ativo: 'OIBR3', Empresa: 'OI' }), stock({ Ativo: 'OK3', Empresa: 'OK' })];
        assert.deepEqual(rankStocks(stocks).map(s => s.Ativo), ['OK3']);
        assert.deepEqual(rankStocks(stocks, { excludedTickers: [] }).map(s => s.Ativo).sort(), ['OIBR3', 'OK3']);
    });

    test('ranks by EV/EBIT ascending and numbers the result', () => {
        const stocks = [
            stock({ Ativo: 'C3', Empresa: 'C', 'EV/EBIT': 9 }),
            stock({ Ativo: 'A3', Empresa: 'A', 'EV/EBIT': 2 }),
            stock({ Ativo: 'B3', Empresa: 'B', 'EV/EBIT': 4 }),
        ];
        const ranked = rankStocks(stocks);
        assert.deepEqual(ranked.map(s => [s.Ranking, s.Ativo]), [[1, 'A3'], [2, 'B3'], [3, 'C3']]);
        assert.deepEqual(Object.keys(ranked[0])[0], 'Ranking');
    });

    test('keeps only the most liquid ticker of each company', () => {
        const stocks = [
            stock({ Ativo: 'PETR3', Empresa: 'PETROBRAS', 'Liquidez Média Diária': 2e8 }),
            stock({ Ativo: 'PETR4', Empresa: 'PETROBRAS', 'Liquidez Média Diária': 9e8 }),
        ];
        assert.deepEqual(rankStocks(stocks).map(s => s.Ativo), ['PETR4']);
    });

    test('respects limit and minimum dividend yield', () => {
        const stocks = Array.from({ length: 80 }, (_, i) =>
            stock({ Ativo: `S${i}3`, Empresa: `S${i}`, 'EV/EBIT': i, 'Dividend Yield': 7 + (i % 5) }));
        assert.equal(rankStocks(stocks).length, 50);
        assert.equal(rankStocks(stocks, { limit: 10 }).length, 10);
        assert.ok(rankStocks(stocks, { minDividendYield: 10 }).every(s => s['Dividend Yield'] > 10));
    });

    test('does not mutate the input', () => {
        const stocks = [stock()];
        rankStocks(stocks);
        assert.equal(stocks[0].Ranking, undefined);
    });
});
