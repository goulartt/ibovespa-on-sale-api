const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompanyAsOf, availableOn } = require('../src/sources/cvm');
const { parseHistory, marketAt, adjCloseOn } = require('../src/sources/yahoo');
const { parseCdi } = require('../src/sources/benchmarks');
const {
    simulate, rebalanceDates, cdiIndex, summarizeSeries, yearlyReturns, sampleCurve, maxDrawdown,
} = require('../src/backtest/engine');

// ---- CVM point in time ----

function filing(type, start, end, ebit, received) {
    const con = new Map([
        [`DRE|ÚLTIMO|${start}|3.01`, 1000], [`DRE|ÚLTIMO|${start}|3.05`, ebit], [`DRE|ÚLTIMO|${start}|3.11`, ebit / 2],
        ['BP|2.03', 500], ['BP|2.02', 100],
    ]);
    if (type === 'ITR') {
        const prevStart = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
        con.set(`DRE|PENÚLTIMO|${prevStart}|3.01`, 900).set(`DRE|PENÚLTIMO|${prevStart}|3.05`, 50).set(`DRE|PENÚLTIMO|${prevStart}|3.11`, 25);
    }
    return {
        type, receivedAt: received, con, ind: new Map(), shares: { on: 100, pn: 0 },
        labels: { con: new Map([['3.05', 'Resultado Antes do Resultado Financeiro e dos Tributos'], ['3.11', 'Lucro/Prejuízo Consolidado do Período']]), ind: new Map() },
        equityAccount: { con: '2.03' }, nonCurrentLiabilitiesAccount: { con: '2.02' },
    };
}

const company = {
    filings: new Map([
        ['2024-12-31', filing('DFP', '2024-01-01', '2024-12-31', 200, '2025-03-20')],
        ['2025-03-31', filing('ITR', '2025-01-01', '2025-03-31', 80, '2025-05-10')],
    ]),
};

test('buildCompanyAsOf only uses filings delivered by the date', () => {
    assert.equal(buildCompanyAsOf('X', company, '2025-03-01'), null);
    const april = buildCompanyAsOf('X', company, '2025-04-01');
    assert.equal(april.dataBalanco, '2024-12-31');
    assert.equal(april.ebit, 200);
    const june = buildCompanyAsOf('X', company, '2025-06-01');
    assert.equal(june.dataBalanco, '2025-03-31');
    assert.equal(june.ebit, 200 + 80 - 50); // TTM
});

test('buildCompanyAsOf drops companies whose last filing is too old', () => {
    assert.equal(buildCompanyAsOf('X', company, '2027-01-01'), null);
});

test('availableOn falls back to the legal deadline when the delivery date is unknown', () => {
    assert.equal(availableOn('2024-03-31', { type: 'ITR' }), '2024-05-15');
    assert.equal(availableOn('2024-12-31', { type: 'DFP' }), '2025-03-31');
    assert.equal(availableOn('2024-12-31', { type: 'DFP', receivedAt: '2025-02-10' }), '2025-02-10');
});

// ---- Yahoo history ----

const ts = iso => Date.parse(`${iso}T13:00:00Z`) / 1000;
const chart = {
    meta: { gmtoffset: -10800 },
    timestamp: [ts('2024-01-02'), ts('2024-01-03'), ts('2024-06-03'), ts('2024-06-04')],
    indicators: {
        quote: [{ close: [5, 5, 6, null], volume: [200, 200, 100, 0] }],
        adjclose: [{ adjclose: [4, 4.1, 5.5, null] }],
    },
    events: {
        dividends: { a: { date: ts('2024-01-03'), amount: 0.5 }, b: { date: ts('2024-06-03'), amount: 0.25 } },
        splits: { s: { date: ts('2024-03-01'), numerator: 2, denominator: 1 } },
    },
};

test('parseHistory keeps valid days with total-return prices', () => {
    const h = parseHistory(chart);
    assert.deepEqual(h.days.map(d => d.date), ['2024-01-02', '2024-01-03', '2024-06-03']);
    assert.equal(h.splits[0].iso, '2024-03-01');
    assert.equal(adjCloseOn(h, '2024-01-03'), 4.1);
    assert.equal(adjCloseOn(h, '2024-01-04'), null);
});

test('marketAt ignores later data and undoes later splits', () => {
    const h = parseHistory(chart);
    const jan = marketAt(h, '2024-01-10');
    assert.equal(jan.price, 10); // 5 adjusted x 2:1 split after the date
    assert.equal(jan.dividendos12m, 1); // only the January dividend, at the old share count
    assert.equal(jan.liquidezMediaDiaria, 1000);
    const jun = marketAt(h, '2024-06-03');
    assert.equal(jun.price, 6);
    assert.equal(jun.dividendos12m, 0.75);
    assert.equal(marketAt(h, '2023-12-01'), null);
    assert.equal(marketAt(h, '2024-03-01'), null); // no trade in the previous 30 days
});

test('parseCdi converts SGS rows', () => {
    const rates = parseCdi([{ data: '02/01/2023', valor: '0.050788' }, { data: 'x', valor: 'y' }]);
    assert.deepEqual([...rates], [['2023-01-02', 0.050788]]);
});

// ---- Engine ----

const calendar = ['2023-12-29', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08'];
const flatCdi = cdiIndex(calendar, new Map());
const rankingOf = names => names.map((n, i) => ({ Ativo: n, Empresa: n, Ranking: i + 1 }));

test('cdiIndex compounds the previous day rate', () => {
    const idx = cdiIndex(['a', 'b', 'c'], new Map([['a', 1], ['b', 2]]));
    assert.equal(idx.get('a'), 1);
    assert.equal(idx.get('b'), 1.01);
    assert.ok(Math.abs(idx.get('c') - 1.01 * 1.02) < 1e-12);
});

test('buy and hold keeps the initial portfolio', () => {
    const prices = { A: [10, 10, 11, 12, 12], B: [10, 10, 9, 8, 8] };
    const priceOn = (t, d) => prices[t]?.[calendar.indexOf(d) - 1] ?? null;
    const asked = [];
    const r = simulate({
        calendar, start: '2024-01-02', end: '2024-01-08', cdi: flatCdi, priceOn, mode: 'buyAndHold', size: 2, cost: 0,
        rankAt: asOf => { asked.push(asOf); return rankingOf(['A', 'B', 'C']); },
    });
    assert.deepEqual(asked, ['2023-12-29']); // ranking from the day before the trade
    assert.deepEqual(r.initial.map(p => p.ticker), ['A', 'B']);
    assert.equal(r.values[r.values.length - 1][1], 1); // +20% and -20%
    assert.deepEqual(r.trades, []);
});

test('rotation sells only what falls out of the buffer and buys the best not held', () => {
    const priceOn = () => 10;
    const rankings = {
        '2023-12-29': rankingOf(['A', 'B']),
        '2024-01-04': rankingOf(['C', 'A', 'D', 'E']), // B is gone, A is still within the buffer
    };
    const r = simulate({
        calendar, start: '2024-01-02', end: '2024-01-08', cdi: flatCdi, priceOn, mode: 'rotation',
        size: 2, buffer: 3, cost: 0.01, rebalanceOn: ['2024-01-05'], rankAt: asOf => rankings[asOf],
    });
    assert.deepEqual(r.trades, [{
        date: '2024-01-05',
        sold: [{ ticker: 'B', empresa: 'B', rank: null }],
        bought: [{ ticker: 'C', empresa: 'C', rank: 1 }],
    }]);
    assert.deepEqual(r.holdings.sort(), ['A', 'C']);
    // 1% to buy both, then 1% to sell B and 1% to buy C
    const expected = 0.5 * 0.99 + 0.5 * 0.99 * 0.99 * 0.99;
    assert.ok(Math.abs(r.values[r.values.length - 1][1] - expected) < 1e-12);
});

test('with keepRankAt, positions stay while they pass the looser ranking', () => {
    const rankings = {
        '2023-12-29': rankingOf(['A', 'B']),
        '2024-01-04': rankingOf(['C', 'D', 'E', 'F']), // A and B are gone from the strict ranking
    };
    const r = simulate({
        calendar, start: '2024-01-02', end: '2024-01-08', cdi: flatCdi, priceOn: () => 10, mode: 'rotation',
        size: 2, buffer: 2, cost: 0, rebalanceOn: ['2024-01-05'],
        rankAt: asOf => rankings[asOf],
        keepRankAt: () => rankingOf(['Z', 'A']), // A still passes the looser rules
    });
    assert.deepEqual(r.trades, [{
        date: '2024-01-05',
        sold: [{ ticker: 'B', empresa: 'B', rank: null }],
        bought: [{ ticker: 'C', empresa: 'C', rank: 1 }],
    }]);
});

test('a delisted position becomes cash earning the CDI', () => {
    const cdi = cdiIndex(calendar, new Map(calendar.map(d => [d, 1])));
    const priceOn = (t, d) => (t === 'A' && d > '2024-01-03' ? null : 10);
    const r = simulate({
        calendar, start: '2024-01-02', end: '2024-01-08', cdi, priceOn, mode: 'buyAndHold', size: 1, cost: 0,
        maxStaleDays: 1, rankAt: () => rankingOf(['A']),
    });
    assert.deepEqual(r.events, [{ date: '2024-01-05', ticker: 'A', event: 'sem cotação' }]);
    assert.ok(Math.abs(r.values[r.values.length - 1][1] - 1.01) < 1e-12); // one day of CDI after delisting
});

test('rebalanceDates picks the first trading day after each anchor', () => {
    const cal = ['2024-01-02', '2024-04-04', '2024-04-08', '2024-05-21', '2024-08-20', '2024-11-21', '2025-04-07'];
    assert.deepEqual(rebalanceDates(cal, '2024-01-02', '2024-12-31'), ['2024-04-08', '2024-05-21', '2024-08-20', '2024-11-21']);
});

test('metrics: return, CDI comparison, drawdown and yearly returns', () => {
    const values = [['2023-12-29', 1], ['2024-06-28', 1.2], ['2024-12-30', 0.9], ['2025-03-31', 1.35]];
    const cdi = [['2023-12-29', 1], ['2024-06-28', 1.05], ['2024-12-30', 1.1], ['2025-03-31', 1.125]];
    const m = summarizeSeries(values, cdi);
    assert.ok(Math.abs(m.retorno - 35) < 1e-9);
    assert.ok(Math.abs(m.cdi - 12.5) < 1e-9);
    assert.ok(Math.abs(m.percentualCdi - 280) < 1e-9);
    assert.ok(Math.abs(maxDrawdown(values) + 25) < 1e-9);
    const yearly = yearlyReturns(values);
    assert.ok(Math.abs(yearly['2024'] + 10) < 1e-9);
    assert.ok(Math.abs(yearly['2025'] - 50) < 1e-9);
    assert.deepEqual(sampleCurve([['a', 2], ['b', 3], ['c', 4]], 2), [['a', 1], ['c', 2]]);
});

// ---- Share count history (FRE) ----
const { cvmZip } = require('./helpers');
const { ingestCapital, finalizeCapital, sharesFromCapital } = require('../src/sources/cvm');

test('share counts before 2020 come from the FRE capital history', () => {
    const H = ['CNPJ_Companhia', 'Data_Referencia', 'Versao', 'Tipo_Capital', 'Data_Autorizacao_Aprovacao', 'Quantidade_Acoes_Ordinarias', 'Quantidade_Acoes_Preferenciais'];
    const zip = cvmZip({ 'fre_cia_aberta_capital_social_2015.csv': [H,
        ['X', '2015-01-01', '1', 'Capital Emitido', '2012-05-01', '90', '0'],
        ['X', '2015-01-01', '1', 'Capital Integralizado', '2012-05-01', '100', '50'],
        ['X', '2015-01-01', '1', 'Capital Integralizado', '2014-07-01', '200', '50'],
        ['X', '2015-01-01', '1', 'Capital Autorizado', '2014-08-01', '999', '0'],
    ] });
    const history = new Map();
    ingestCapital(history, zip, 2015);
    const capital = finalizeCapital(history).get('X');
    assert.deepEqual(capital, [{ date: '2012-05-01', on: 100, pn: 50 }, { date: '2014-07-01', on: 200, pn: 50 }]);
    assert.equal(sharesFromCapital(capital, '2012-01-01'), null);
    assert.deepEqual(sharesFromCapital(capital, '2013-01-01'), { on: 100, pn: 50 });
    assert.deepEqual(sharesFromCapital(capital, '2015-01-01'), { on: 200, pn: 50 });

    const noShares = { filings: new Map([['2024-12-31', { ...filing('DFP', '2024-01-01', '2024-12-31', 200, '2025-03-20'), shares: undefined }]]) };
    assert.equal(buildCompanyAsOf('X', noShares, '2025-04-01'), null);
    const built = buildCompanyAsOf('X', noShares, '2025-04-01', [{ date: '2020-01-01', on: 300, pn: 0 }]);
    assert.deepEqual(built.acoes, { on: 300, pn: 0 });
});
