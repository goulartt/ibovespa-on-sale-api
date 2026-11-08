// Second round: refine what was robust in both periods (round 1: variants.js).
const base = require('./variants');
const pick = name => base.find(v => v.name === name);
const profits = s => (s['Lucros Anuais'] || []).map(y => y.lucro);
const aboveMa200 = s => s.MA200 > 0 && s['Cotação'] > s.MA200;
function stableProfit(s) {
    const p = profits(s);
    if (p.length < 3 || !p.every(x => x > 0)) return false;
    const mean = p.reduce((a, b) => a + b, 0) / p.length;
    const sd = Math.sqrt(p.reduce((a, x) => a + (x - mean) ** 2, 0) / p.length);
    return sd / mean <= 0.5;
}
const both = (...fs) => s => fs.every(f => f(s));

module.exports = [
    pick('DV top10 trimestral (atual)'),
    pick('DV top20 + MM200'),
    { name: 'DV top10 + MM200', strategy: 'deepValue', prefilter: aboveMa200, prefilterName: 'ma200' },
    // trend only to buy; keep while within the top 40 of the plain ranking
    { name: 'DV top20 MM200 só compra', strategy: 'deepValue', size: 20, prefilter: aboveMa200, prefilterName: 'ma200', keep: { strategy: 'deepValue', criteria: { limit: 40 } } },
    { name: 'DV top20 + MM200 semestral', strategy: 'deepValue', size: 20, prefilter: aboveMa200, prefilterName: 'ma200', anchors: ['04-05', '11-20'] },

    pick('Q top10 trimestral (atual)'),
    pick('Q top20 + lucro estável'),
    { name: 'Q top10 + lucro estável', strategy: 'qualidade', prefilter: stableProfit, prefilterName: 'stable' },
    { name: 'Q top20 + estável + MM200', strategy: 'qualidade', size: 20, prefilter: both(stableProfit, aboveMa200), prefilterName: 'stable+ma200' },

    pick('DIV top10 trimestral (atual)'),
    { name: 'DIV top10 + MM200', strategy: 'dividendos', prefilter: aboveMa200, prefilterName: 'ma200' },
    { name: 'DIV top10 + lucro estável', strategy: 'dividendos', prefilter: stableProfit, prefilterName: 'stable' },
];
