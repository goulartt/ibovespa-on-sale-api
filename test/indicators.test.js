const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { round, ratio, percent, shareCountScale, marketCap, buildStock, buildStocks } = require('../src/domain/indicators');

describe('number helpers', () => {
    test('round handles null, NaN and Infinity', () => {
        assert.equal(round(1.23456), 1.23);
        assert.equal(round(1234.5, 0), 1235);
        assert.equal(round(null), null);
        assert.equal(round(NaN), null);
        assert.equal(round(Infinity), null);
    });

    test('ratio and percent return null on missing data or division by zero', () => {
        assert.equal(ratio(10, 4), 2.5);
        assert.equal(ratio(10, 0), null);
        assert.equal(ratio(null, 2), null);
        assert.equal(percent(1, 4), 25);
        assert.equal(percent(1, null), null);
    });
});

describe('shareCountScale', () => {
    test('keeps share counts reported in units', () => {
        // market cap 50bn, equity 20bn -> P/VP 2.5
        assert.equal(shareCountScale({ patrimonio: 20e9, receita: 100e9 }, 50e9), 1);
    });

    test('detects share counts reported in thousands', () => {
        // Ambev-like: raw cap is 1000x too small -> P/VP 0.0026
        assert.equal(shareCountScale({ patrimonio: 90e9, receita: 90e9 }, 240e6), 1000);
    });

    test('falls back to revenue when equity is negative', () => {
        assert.equal(shareCountScale({ patrimonio: -5e9, receita: 10e9 }, 5e6), 1000);
        assert.equal(shareCountScale({ patrimonio: -5e9, receita: 10e9 }, 5e9), 1);
    });

    test('does not scale when there is no equity nor revenue to compare with', () => {
        assert.equal(shareCountScale({ patrimonio: null, receita: null }, 1e3), 1);
    });
});

describe('marketCap', () => {
    const company = {
        acoes: { on: 1000, pn: 2000 },
        patrimonio: 10_000,
        receita: 10_000,
        tickers: [{ ticker: 'XXXX3', classe: 'ON' }, { ticker: 'XXXX4', classe: 'PN' }, { ticker: 'XXXX11', classe: 'UNIT' }],
    };

    test('prices each share class separately', () => {
        assert.equal(marketCap(company, { XXXX3: 10, XXXX4: 5, XXXX11: 999 }), 1000 * 10 + 2000 * 5);
    });

    test('uses the other class price when one class does not trade', () => {
        assert.equal(marketCap(company, { XXXX4: 5 }), 3000 * 5);
    });

    test('returns null when only units have a price', () => {
        assert.equal(marketCap(company, { XXXX11: 30 }), null);
    });
});

describe('buildStock', () => {
    const company = {
        empresa: 'EMPRESA X',
        dataBalanco: '2026-09-30',
        receita: 1000,
        ebit: 200,
        lucro: 100,
        patrimonio: 500,
        dividaLiquida: 300,
    };
    const market = { price: 10, dividendos12m: 0.8, liquidezMediaDiaria: 1234567.89, MA5: 9.876, MA200: null };

    test('computes valuation and profitability indicators', () => {
        const s = buildStock(company, 'XXXX3', market, 1000);
        assert.equal(s.Ativo, 'XXXX3');
        assert.equal(s['P/L'], 10);
        assert.equal(s['P/VP'], 2);
        assert.equal(s.PSR, 1);
        assert.equal(s['Dividend Yield'], 8);
        assert.equal(s['P/EBIT'], 5);
        assert.equal(s['EV/EBIT'], 6.5); // (1000 + 300) / 200
        assert.equal(s['Margem Ebit'], 20);
        assert.equal(s['Margem Líquida'], 10);
        assert.equal(s.ROE, 20);
        assert.equal(s['Dívida Líquida/EBIT'], 1.5);
        assert.equal(s['Liquidez Média Diária'], 1234568);
        assert.equal(s.MA5, 9.88);
        assert.equal(s.MA200, null);
        assert.equal(s['Situação'], null);
    });

    test('carries the CVM issuer situation', () => {
        const s = buildStock({ ...company, situacao: 'Em recuperação judicial' }, 'XXXX3', market, 1000);
        assert.equal(s['Situação'], 'Em recuperação judicial');
    });

    test('computes payout, ROIC, dividend history and profit history', () => {
        const s = buildStock(
            { ...company, lucrosAnuais: [{ ano: 2024, lucro: -5.4 }, { ano: 2025, lucro: 80.6 }] },
            'XXXX3',
            { ...market, dividendosMedia5a: 0.5, anosComDividendos: 4 },
            1000,
        );
        assert.equal(s.Payout, 80); // 8% yield x 1000 cap / 100 profit
        assert.equal(s.ROIC, 25); // 200 EBIT / (500 equity + 300 net debt)
        assert.equal(s['DY Médio 5 Anos'], 5);
        assert.equal(s['Anos com Dividendos'], 4);
        assert.deepEqual(s['Lucros Anuais'], [{ ano: 2024, lucro: -5 }, { ano: 2025, lucro: 81 }]);
        assert.equal(s['Anos com Lucro'], 1);
    });

    test('computes ROCE and net debt / EBITDA', () => {
        const s = buildStock({ ...company, ebitda: 400, capitalEmpregado: 800 }, 'XXXX3', market, 1000);
        assert.equal(s.ROCE, 25); // 200 EBIT / 800 capital employed
        assert.equal(s['Dívida Líquida/EBITDA'], 0.75); // 300 / 400
        const missing = buildStock({ ...company, ebitda: -5, capitalEmpregado: null }, 'XXXX3', market, 1000);
        assert.equal(missing.ROCE, null);
        assert.equal(missing['Dívida Líquida/EBITDA'], null);
    });

    test('payout and ROIC are null when they cannot be computed', () => {
        const s = buildStock({ ...company, lucro: -10, patrimonio: -400 }, 'XXXX3', market, 1000);
        assert.equal(s.Payout, null);
        assert.equal(s.ROIC, null);
    });

    test('financial companies have no EV/EBIT', () => {
        const s = buildStock({ ...company, ebit: null, dividaLiquida: null }, 'BANK4', market, 1000);
        assert.equal(s['EV/EBIT'], null);
        assert.equal(s['Margem Ebit'], null);
        assert.equal(s['P/L'], 10);
    });
});

describe('buildStocks', () => {
    test('builds one entry per priced ticker, sorted, skipping companies without a price', () => {
        const base = { acoes: { on: 100, pn: 0 }, patrimonio: 1000, receita: 1000, lucro: 100, ebit: 100, dividaLiquida: 0 };
        const companies = [
            { ...base, empresa: 'B', tickers: [{ ticker: 'BBBB3', classe: 'ON' }] },
            { ...base, empresa: 'A', tickers: [{ ticker: 'AAAA3', classe: 'ON' }, { ticker: 'AAAA11', classe: 'UNIT' }] },
            { ...base, empresa: 'C', tickers: [{ ticker: 'CCCC3', classe: 'ON' }] },
        ];
        const market = {
            AAAA3: { price: 10, dividendos12m: 1 },
            AAAA11: { price: 30, dividendos12m: 3 },
            BBBB3: { price: 20, dividendos12m: 0 },
        };
        const stocks = buildStocks(companies, market);
        assert.deepEqual(stocks.map(s => s.Ativo), ['AAAA11', 'AAAA3', 'BBBB3']);
        assert.equal(stocks.find(s => s.Ativo === 'AAAA11')['P/L'], 10); // company-level cap from the ON price
    });
});
