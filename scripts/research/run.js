// Runs strategy variants on the cached data (build-cache.js) and prints a comparison table.
// Usage: node scripts/research/run.js <cache-file> <variants-module> [filter-regex]
const fs = require('fs');
const v8 = require('v8');
const path = require('path');
const { adjCloseOn } = require('../../src/sources/yahoo');
const { createRanker } = require('../../src/backtest/pointInTime');
const { rankStocks } = require('../../src/domain/ranking');
const { simulate, rebalanceDates, cdiIndex, summarizeSeries } = require('../../src/backtest/engine');

const [file, variantsFile, filter] = process.argv.slice(2);
const data = v8.deserialize(fs.readFileSync(file));
const variants = require(path.resolve(variantsFile)).filter(v => !filter || new RegExp(filter).test(v.name));

const calendar = data.ibov.days.map(d => d.date);
const today = calendar[calendar.length - 1];
const cdi = cdiIndex(calendar, data.cdiRates);
const ibovOn = new Map(data.ibov.days.map(d => [d.date, d.adj]));
const ranker = createRanker(data);
const priceOn = (ticker, day) => adjCloseOn(data.histories[ticker], day);
const firstDay = from => calendar.find(d => d >= from);
const lastDay = to => [...calendar].reverse().find(d => d <= to);

const rankCache = new Map();
function rankWith(spec, asOf) {
    const key = `${JSON.stringify(spec.criteria || {})}|${spec.strategy}|${spec.prefilterName || ''}|${asOf}`;
    if (!rankCache.has(key)) {
        const stocks = ranker.stocksAt(asOf).filter(spec.prefilter || (() => true));
        rankCache.set(key, rankStocks(stocks, { strategy: spec.strategy, limit: Infinity, ...spec.criteria }));
    }
    return rankCache.get(key);
}

const PERIODS = [
    ['2014-2019 (escolha)', '2014-01-01', '2019-12-31'],
    ['2020-hoje (validação)', '2020-01-01', today],
    ['2014-hoje', '2014-01-01', today],
];

const pct = v => (v == null ? '   —  ' : `${v >= 0 ? ' ' : ''}${v.toFixed(1)}%`.padStart(7));

function run(v, start, end) {
    const s = firstDay(start);
    const e = lastDay(end);
    const result = simulate({
        calendar, start: s, end: e, cdi, priceOn, mode: v.mode || 'rotation',
        size: v.size || 10, buffer: v.buffer || 2 * (v.size || 10), cost: 0.001,
        rebalanceOn: rebalanceDates(calendar, s, e, v.anchors),
        rankAt: asOf => rankWith(v, asOf),
        keepRankAt: v.keep ? asOf => rankWith(v.keep, asOf) : null,
    });
    const days = calendar.filter(d => d >= s && d <= e);
    const m = summarizeSeries(result.values, days.map(d => [d, cdi.get(d)]));
    const years = (Date.parse(e) - Date.parse(s)) / (365.25 * 86400000);
    const trades = result.trades.reduce((n, t) => n + t.sold.length, 0);
    return { ...m, cdiAnual: (Math.pow(1 + m.cdi / 100, 1 / years) - 1) * 100, vendasAno: trades / years };
}

const header = ['variante'.padEnd(34), ...PERIODS.map(([n]) => `${n} a.a. (CDI)`.padEnd(30)), 'maxDD', 'vendas/ano', 'inícios>CDI'];
console.log(header.join(' | '));
// benchmarks
const bench = (name, valuesFor) => {
    const cells = PERIODS.map(([, a, b]) => {
        const s = firstDay(a);
        const e = lastDay(b);
        const days = calendar.filter(d => d >= s && d <= e);
        const m = summarizeSeries(days.map(d => [d, valuesFor(d)]), days.map(d => [d, cdi.get(d)]));
        return `${pct(m.retornoAnual)}`.padEnd(30);
    });
    console.log([name.padEnd(34), ...cells].join(' | '));
};
bench('CDI', d => cdi.get(d));
bench('Ibovespa', d => ibovOn.get(d));

for (const v of variants) {
    const cells = [];
    let full;
    for (const [, a, b] of PERIODS) {
        const m = run(v, a, b);
        full = m;
        cells.push(`${pct(m.retornoAnual)} (${pct(m.cdiAnual).trim()}) ${pct(m.retornoAnual - m.cdiAnual)}`.padEnd(30));
    }
    // robustness: one portfolio started each January, held to today
    const starts = [];
    for (let y = 2014; y <= Number(today.slice(0, 4)) - 1; y++) starts.push(run(v, `${y}-01-01`, today));
    const beat = starts.filter(m => m.retorno > m.cdi).length;
    console.log([v.name.padEnd(34), ...cells, pct(full.maxDrawdown), full.vendasAno.toFixed(1).padStart(5), `${beat}/${starts.length}`].join(' | '));
}
