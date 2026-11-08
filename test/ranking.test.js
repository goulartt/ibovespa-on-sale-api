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

    test('excludes companies in recovery, bankruptcy or liquidation', () => {
        const stocks = [
            stock({ Ativo: 'LIGT3', Empresa: 'LIGHT', 'Situação': 'Em recuperação judicial' }),
            stock({ Ativo: 'PCAR3', Empresa: 'CBD', 'Situação': 'Em recuperação extrajudicial' }),
            stock({ Ativo: 'OK3', Empresa: 'OK', 'Situação': null }),
            stock({ Ativo: 'OLD3', Empresa: 'OLD' }), // datasets built before the field existed
        ];
        assert.deepEqual(rankStocks(stocks).map(s => s.Ativo).sort(), ['OK3', 'OLD3']);
    });

    test('supports manual exclusions', () => {
        const stocks = [stock({ Ativo: 'AAA3', Empresa: 'A' }), stock({ Ativo: 'BBB3', Empresa: 'B' })];
        assert.deepEqual(rankStocks(stocks, { excludedTickers: ['AAA3'] }).map(s => s.Ativo), ['BBB3']);
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

describe('dividend sustainability and quality rules', () => {
    const keeps = (overrides) => rankStocks([stock(overrides)]).length === 1;

    test('requires DY above 6% in 12 months and above 5% on the 5-year average', () => {
        assert.equal(keeps({ 'Dividend Yield': 55, 'DY Médio 5 Anos': 5.5 }), true);
        assert.equal(keeps({ 'Dividend Yield': 55, 'DY Médio 5 Anos': 5 }), false); // one-off special dividend
        assert.equal(keeps({ 'Dividend Yield': 6, 'DY Médio 5 Anos': 12 }), false); // stopped paying recently
        assert.equal(keeps({ 'DY Médio 5 Anos': null }), false);
    });

    test('requires a payout between 0 and 120% of net income', () => {
        assert.equal(keeps({ Payout: 120 }), true);
        assert.equal(keeps({ Payout: 121 }), false);
        assert.equal(keeps({ Payout: null }), false);
    });

    test('requires dividends in at least 3 of the last 5 years', () => {
        assert.equal(keeps({ 'Anos com Dividendos': 3 }), true);
        assert.equal(keeps({ 'Anos com Dividendos': 2 }), false);
    });

    test('requires net debt below 3x EBIT, 4.5x for utilities (net cash is fine)', () => {
        assert.equal(keeps({ 'Dívida Líquida/EBIT': -0.5 }), true);
        assert.equal(keeps({ 'Dívida Líquida/EBIT': 3 }), false);
        assert.equal(keeps({ 'Dívida Líquida/EBIT': 4, Setor: 'Energia e saneamento' }), true);
        assert.equal(keeps({ 'Dívida Líquida/EBIT': 4.5, Setor: 'Energia e saneamento' }), false);
        assert.equal(keeps({ 'Dívida Líquida/EBIT': null }), false);
    });

    test('requires a profit in every annual statement (at least 3) and in the last 12 months', () => {
        const years = values => values.map((lucro, i) => ({ ano: 2021 + i, lucro }));
        assert.equal(keeps({ 'Lucros Anuais': years([1, 2, 3]) }), true);
        assert.equal(keeps({ 'Lucros Anuais': years([1, 2]) }), false);
        assert.equal(keeps({ 'Lucros Anuais': years([1, -2, 3, 4, 5]) }), false);
        assert.equal(keeps({ 'P/L': -3 }), false);
        assert.equal(keeps({ 'Lucros Anuais': undefined }), false);
    });
});

describe('magic formula sort', () => {
    test('ranks by the sum of the EV/EBIT and ROIC positions', () => {
        const stocks = [
            stock({ Ativo: 'CHEAP3', Empresa: 'CHEAP', 'EV/EBIT': 2, ROIC: 5 }),   // ev 0 + roic 2 = 2
            stock({ Ativo: 'QUAL3', Empresa: 'QUAL', 'EV/EBIT': 6, ROIC: 40 }),    // ev 2 + roic 0 = 2
            stock({ Ativo: 'BOTH3', Empresa: 'BOTH', 'EV/EBIT': 3, ROIC: 30 }),    // ev 1 + roic 1 = 2... tie
            stock({ Ativo: 'BAD3', Empresa: 'BAD', 'EV/EBIT': 9, ROIC: 1 }),       // ev 3 + roic 3 = 6
        ];
        const ranked = rankStocks(stocks, { sort: 'magicFormula' }).map(s => s.Ativo);
        assert.deepEqual(ranked, ['CHEAP3', 'BOTH3', 'QUAL3', 'BAD3']); // ties broken by EV/EBIT
        assert.deepEqual(rankStocks(stocks).map(s => s.Ativo), ['CHEAP3', 'BOTH3', 'QUAL3', 'BAD3']);
    });

    test('quality can beat a slightly cheaper but poor business', () => {
        const stocks = [
            stock({ Ativo: 'A3', Empresa: 'A', 'EV/EBIT': 2, ROIC: 3 }),
            stock({ Ativo: 'B3', Empresa: 'B', 'EV/EBIT': 2.5, ROIC: 35 }),
            stock({ Ativo: 'C3', Empresa: 'C', 'EV/EBIT': 4, ROIC: 30 }),
        ];
        assert.equal(rankStocks(stocks, { sort: 'magicFormula' })[0].Ativo, 'B3');
        assert.equal(rankStocks(stocks)[0].Ativo, 'A3');
    });

    test('rejects unknown sorts', () => {
        assert.throws(() => rankStocks([stock()], { sort: 'nope' }), /unknown sort/);
    });
});

describe('quality strategy (qualidade a bom preço)', () => {
    const quality = (overrides = {}) => stock({ ROCE: 20, 'Dívida Líquida/EBITDA': 0.5, 'P/L': 8, ...overrides });
    const keeps = overrides => rankStocks([quality(overrides)], { strategy: 'qualidade' }).length === 1;

    test('requires ROCE above 15%', () => {
        assert.equal(keeps({ ROCE: 15.1 }), true);
        assert.equal(keeps({ ROCE: 15 }), false);
        assert.equal(keeps({ ROCE: null }), false);
    });

    test('requires net debt below 1.5x EBITDA (net cash is fine)', () => {
        assert.equal(keeps({ 'Dívida Líquida/EBITDA': -2 }), true);
        assert.equal(keeps({ 'Dívida Líquida/EBITDA': 1.03 }), true); // LEVE3
        assert.equal(keeps({ 'Dívida Líquida/EBITDA': 1.5 }), false);
        assert.equal(keeps({ 'Dívida Líquida/EBITDA': null }), false);
    });

    test('requires P/L between 0 and 15', () => {
        assert.equal(keeps({ 'P/L': 13.5 }), true); // B3SA3
        assert.equal(keeps({ 'P/L': 15 }), true);
        assert.equal(keeps({ 'P/L': 15.1 }), false);
        assert.equal(keeps({ 'P/L': -4 }), false);
    });

    test('ignores the dividend rules and keeps the common ones', () => {
        assert.equal(keeps({ 'Dividend Yield': 0, 'DY Médio 5 Anos': 0, Payout: null, 'Anos com Dividendos': 0 }), true);
        assert.equal(keeps({ 'Liquidez Média Diária': 10 }), false);
        assert.equal(keeps({ 'Situação': 'Em recuperação judicial' }), false);
    });

    test('rejects unknown strategies', () => {
        assert.throws(() => rankStocks([stock()], { strategy: 'nope' }), /unknown strategy/);
    });
});

describe('deep value strategy', () => {
    const deep = (stocks, extra) => rankStocks(stocks, { strategy: 'deepValue', ...extra });

    test('keeps only the basic filters: liquidity, positive EBIT, has EV/EBIT, no distress', () => {
        const stocks = [
            stock({ Ativo: 'OK3', Empresa: 'OK', 'Dividend Yield': 0, 'DY Médio 5 Anos': 0, Payout: null, 'Anos com Dividendos': 0, 'Dívida Líquida/EBIT': 9, 'Lucros Anuais': [] }),
            stock({ Ativo: 'ILIQ3', Empresa: 'ILIQ', 'Liquidez Média Diária': 900_000 }),
            stock({ Ativo: 'LOSS3', Empresa: 'LOSS', 'Margem Ebit': -2 }),
            stock({ Ativo: 'BANK4', Empresa: 'BANK', 'EV/EBIT': null }),
            stock({ Ativo: 'RJ3', Empresa: 'RJ', 'Situação': 'Em recuperação judicial' }),
        ];
        assert.deepEqual(deep(stocks).map(s => s.Ativo), ['OK3']);
    });

    test('excludes banks and insurers only in Deep Value', () => {
        const insurer = stock({ Ativo: 'PSSA3', Empresa: 'PORTO', 'Instituição Financeira': true, ROCE: 20, 'Dívida Líquida/EBITDA': 0, 'P/L': 8 });
        assert.deepEqual(deep([insurer]), []);
        assert.equal(rankStocks([insurer]).length, 1); // dividendos
        assert.equal(rankStocks([insurer], { strategy: 'qualidade' }).length, 1);
    });

    test('ranks by the highest EBIT/EV, negative EV last', () => {
        const stocks = [
            stock({ Ativo: 'B3', Empresa: 'B', 'EV/EBIT': 10, 'EBIT/EV': 10 }),
            stock({ Ativo: 'A3', Empresa: 'A', 'EV/EBIT': 2, 'EBIT/EV': 50 }),
            stock({ Ativo: 'NEG3', Empresa: 'NEG', 'EV/EBIT': -2, 'EBIT/EV': -50 }),
            stock({ Ativo: 'OLD3', Empresa: 'OLD', 'EV/EBIT': 4 }), // no EBIT/EV field: 25%
        ];
        assert.deepEqual(deep(stocks).map(s => s.Ativo), ['A3', 'OLD3', 'B3', 'NEG3']);
    });

    test('one ticker per company, the most liquid', () => {
        const stocks = [
            stock({ Ativo: 'XXXX3', Empresa: 'X', 'Liquidez Média Diária': 2e6 }),
            stock({ Ativo: 'XXXX4', Empresa: 'X', 'Liquidez Média Diária': 9e6 }),
        ];
        assert.deepEqual(deep(stocks).map(s => s.Ativo), ['XXXX4']);
    });
});

test('Deep Value only buys stocks above the 200-day moving average', () => {
    const stocks = [
        stock({ Ativo: 'UP3', Empresa: 'UP', 'Cotação': 10, MA200: 9 }),
        stock({ Ativo: 'DOWN3', Empresa: 'DOWN', 'Cotação': 10, MA200: 11 }),
        stock({ Ativo: 'NEW3', Empresa: 'NEW', MA200: null }),
    ];
    assert.deepEqual(rankStocks(stocks, { strategy: 'deepValue' }).map(s => s.Ativo), ['UP3']);
    assert.deepEqual(rankStocks(stocks, { strategy: 'deepValue', requireUptrend: false }).map(s => s.Ativo).sort(), ['DOWN3', 'NEW3', 'UP3']);
});

test('Qualidade requires a stable profit', () => {
    const q = o => stock({ ROCE: 30, 'Dívida Líquida/EBITDA': 0.5, 'P/L': 8, ...o });
    const years = values => values.map((lucro, i) => ({ ano: 2021 + i, lucro }));
    const stocks = [
        q({ Ativo: 'STB3', Empresa: 'STB', 'Lucros Anuais': years([100, 110, 95, 105, 100]) }),
        q({ Ativo: 'CYC3', Empresa: 'CYC', 'Lucros Anuais': years([10, 300, 40, 20, 250]) }), // cyclical
        q({ Ativo: 'LOS3', Empresa: 'LOS', 'Lucros Anuais': years([-10, 100, 100]) }),
    ];
    assert.deepEqual(rankStocks(stocks, { strategy: 'qualidade' }).map(s => s.Ativo), ['STB3']);
    assert.deepEqual(rankStocks(stocks, { strategy: 'qualidade', maxProfitVariation: Infinity }).map(s => s.Ativo).sort(), ['CYC3', 'LOS3', 'STB3']);
});
