const test = require('node:test');
const assert = require('node:assert/strict');
const { intrinsicValue, discountRates, profitVariation, safetyMargin } = require('../src/domain/intrinsicValue');
const { parseTesouro, parseFocus } = require('../src/sources/rates');
const { rankStocks } = require('../src/domain/ranking');
const { buildStocks } = require('../src/domain/indicators');
const { stock } = require('./helpers');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('discount rate: Tesouro IPCA+ + IPCA - 3% of perpetual growth', () => {
    assert.deepEqual(discountRates({ tesouro: 7.5, ipca: 5 }), { retornoExigido: 12.5, crescimentoPerpetuidade: 3, taxaFinal: 9.5 });
});

test('reproduces the example of the video (Caixa Seguridade)', () => {
    // lucro R$ 4 bi, ROE 25%, payout 85%, 3 bi shares, 12.5% - 3% = 9.5%
    const v = intrinsicValue({ lucro: 4e9, roeMedio: 0.25, payoutMedio: 0.85, valorMercado: 3e9 * 12, preco: 12 }, { taxaFinal: 9.5 });
    close(v.crescimento, 3.75);
    close(v.valorJusto, 4e9 * 1.0375 / 0.095, 1);
    close(v.precoTeto, 14.5614, 1e-3);
    close(v.desconto, (v.precoTeto - 12) / v.precoTeto * 100);
});

test('payout is clamped to 0-100% and the method needs profit, ROE and shares', () => {
    const base = { lucro: 100, roeMedio: 0.2, valorMercado: 100, preco: 10 };
    close(intrinsicValue({ ...base, payoutMedio: 1.5 }, { taxaFinal: 10 }).crescimento, 0);
    close(intrinsicValue({ ...base, payoutMedio: null }, { taxaFinal: 10 }).crescimento, 20);
    assert.equal(intrinsicValue({ ...base, lucro: -1 }, { taxaFinal: 10 }), null);
    assert.equal(intrinsicValue({ ...base, roeMedio: null }, { taxaFinal: 10 }), null);
    assert.equal(intrinsicValue({ ...base, valorMercado: 0 }, { taxaFinal: 10 }), null);
    assert.equal(intrinsicValue(base, { taxaFinal: 0 }), null);
});

test('parseTesouro picks the bond closest to 10 years on the latest day', () => {
    const csv = [
        'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha',
        'Tesouro IPCA+ com Juros Semestrais;15/05/2035;05/11/2026;7,91;8,03',
        'Tesouro IPCA+ com Juros Semestrais;15/05/2035;06/11/2026;7,84;7,96',
        'Tesouro IPCA+ com Juros Semestrais;15/05/2037;06/11/2026;7,70;7,82',
        'Tesouro IPCA+ com Juros Semestrais;15/08/2050;06/11/2026;7,10;7,22',
        'Tesouro Prefixado;01/01/2037;06/11/2026;13,1;13,2',
    ].join('\r\n');
    assert.deepEqual(parseTesouro(csv), {
        titulo: 'Tesouro IPCA+ com Juros Semestrais 2037', vencimento: '2037-05-15', data: '2026-11-06', taxa: 7.7,
    });
    assert.equal(parseTesouro('Tipo Titulo;x\nTesouro Selic;01/03/2027;06/11/2026;0,02'), null);
});

test('parseFocus reads the latest median', () => {
    assert.deepEqual(parseFocus({ value: [{ Data: '2026-10-30', Mediana: 4.9553 }] }), { data: '2026-10-30', ipca: 4.9553 });
    assert.equal(parseFocus({ value: [] }), null);
});

test('buildStocks fills the intrinsic value fields when rates are given', () => {
    const company = {
        empresa: 'X', tickers: [{ ticker: 'XXXX3', classe: 'ON' }], acoes: { on: 100, pn: 0 },
        patrimonio: 1000, receita: 2000, lucro: 100, ebit: 150, dividaLiquida: 0, roeMedio: 0.1,
        lucrosAnuais: [{ ano: 2024, lucro: 100 }, { ano: 2025, lucro: 100 }],
    };
    const market = { XXXX3: { price: 5, dividendosMedia5a: 0.5, dividendos12m: 0.5 } };
    const [withRates] = buildStocks([company], market, { rates: { taxaFinal: 10 } });
    assert.equal(withRates['Payout Médio'], 50); // 10% yield x R$ 500 market cap / R$ 100 profit
    assert.equal(withRates['Crescimento Esperado'], 5); // 10% x (1 - 50%)
    assert.equal(withRates['Valor Intrínseco'], 10.5); // 100 x 1.05 / 10% / 100 shares
    assert.equal(withRates['Desconto'], round2((10.5 - 5) / 10.5 * 100));
    assert.equal(withRates['ROE Médio'], 10);
    assert.equal(withRates['Variação do Lucro'], 0);
    assert.equal(withRates['Margem de Segurança'], 20);
    assert.equal(withRates['Preço Teto'], 8.4); // 10.5 x (1 - 20%)
    const [withoutRates] = buildStocks([company], market);
    assert.equal(withoutRates['Valor Intrínseco'], null);
    assert.equal(withoutRates['Preço Teto'], null);
    assert.equal(withoutRates['Margem de Segurança'], null);
});

const round2 = v => Math.round(v * 100) / 100;

test('units get the price target in proportion to their own price', () => {
    const company = {
        empresa: 'U', acoes: { on: 100, pn: 200 }, patrimonio: 1000, receita: 2000, lucro: 300, roeMedio: 0.1,
        tickers: [{ ticker: 'UUUU3', classe: 'ON' }, { ticker: 'UUUU4', classe: 'PN' }, { ticker: 'UUUU11', classe: 'UNIT' }],
        lucrosAnuais: [{ ano: 2025, lucro: 300 }],
    };
    const m = price => ({ price, dividendosMedia5a: 0 });
    const stocks = buildStocks([company], { UUUU3: m(10), UUUU4: m(10), UUUU11: m(30) }, { rates: { taxaFinal: 10 } });
    const byTicker = Object.fromEntries(stocks.map(s => [s.Ativo, s]));
    // value = 300 x 1.1 / 10% = 3300; market cap = 300 shares x 10 = 3000
    assert.equal(byTicker.UUUU3['Valor Intrínseco'], 11);
    assert.equal(byTicker.UUUU11['Valor Intrínseco'], 33); // 1 unit = 3 shares
    assert.equal(byTicker.UUUU11.Desconto, byTicker.UUUU3.Desconto);
});

test('valorIntrinseco ranks by discount, includes banks and needs predictable profit', () => {
    const v = o => stock({ 'Valor Intrínseco': 20, 'Lucro Líquido': 100, ...o });
    const ranked = rankStocks([
        v({ Ativo: 'AAA3', Empresa: 'A', Desconto: 10 }),
        v({ Ativo: 'BNK3', Empresa: 'BANCO', Desconto: 40, 'EV/EBIT': null, 'Instituição Financeira': true }),
        v({ Ativo: 'NEG3', Empresa: 'N', Desconto: -20 }),
        v({ Ativo: 'ONE3', Empresa: 'O', Desconto: 60, 'Lucro Líquido': 500 }), // one-off profit
        v({ Ativo: 'LOS3', Empresa: 'L', Desconto: 70, 'Lucros Anuais': [{ ano: 2023, lucro: -1 }, { ano: 2024, lucro: 100 }, { ano: 2025, lucro: 100 }] }),
        v({ Ativo: 'NOV3', Empresa: 'NV', Desconto: 80, 'Valor Intrínseco': null }),
        v({ Ativo: 'DRP3', Empresa: 'D', Desconto: 90, 'Lucro Líquido': 30 }), // profit collapsed
        v({ Ativo: 'ERR3', Empresa: 'E', Desconto: 95, 'Lucros Anuais': [10, 300, 20, 250, 20].map((lucro, i) => ({ ano: 2021 + i, lucro })) }),
    ], { strategy: 'valorIntrinseco' });
    assert.deepEqual(ranked.map(s => s.Ativo), ['BNK3', 'AAA3', 'NEG3']);
    assert.deepEqual(ranked.map(s => s.Ranking), [1, 2, 3]);
});

test('margin of safety grows with the variation of the annual profits', () => {
    close(profitVariation([100, 100, 100]), 0);
    close(profitVariation([80, 120]), 0.2);
    assert.equal(profitVariation([-10, 10]), null);
    assert.equal(profitVariation([]), null);
    assert.equal(safetyMargin(0.1), 20);
    assert.equal(safetyMargin(0.15), 20);
    assert.equal(safetyMargin(0.2), 30);
    assert.equal(safetyMargin(0.45), 40);
    assert.equal(safetyMargin(null), null);
});

test('Bazin price ceiling: 5-year average dividend / 6%', () => {
    const company = {
        empresa: 'B', tickers: [{ ticker: 'BBBB3', classe: 'ON' }], acoes: { on: 100, pn: 0 },
        patrimonio: 1000, receita: 2000, lucro: 100, lucrosAnuais: [],
    };
    const [stock] = buildStocks([company], { BBBB3: { price: 8, dividendosMedia5a: 0.6 } });
    assert.equal(stock['Preço Teto Bazin'], 10);
    assert.equal(stock['Desconto Bazin'], 20);
    const [none] = buildStocks([company], { BBBB3: { price: 8, dividendosMedia5a: 0 } });
    assert.equal(none['Preço Teto Bazin'], null);
    assert.equal(none['Desconto Bazin'], null);
});
