// Strategy variants for scripts/research/run.js. `prefilter` runs before the strategy rules;
// `keep` is a looser ranking used to decide what to keep (sell only when a stock leaves it).
const profits = s => (s['Lucros Anuais'] || []).map(y => y.lucro);
const consistentProfit = s => profits(s).length >= 3 && profits(s).every(p => p > 0);
const aboveMa200 = s => s.MA200 > 0 && s['Cotação'] > s.MA200;
const noCommodities = s => s.Setor !== 'Commodities';
function stableProfit(s) {
    const p = profits(s);
    if (p.length < 3 || !p.every(x => x > 0)) return false;
    const mean = p.reduce((a, b) => a + b, 0) / p.length;
    const sd = Math.sqrt(p.reduce((a, x) => a + (x - mean) ** 2, 0) / p.length);
    return sd / mean <= 0.5;
}
const both = (...fs) => s => fs.every(f => f(s));

const SEMIANNUAL = ['04-05', '11-20'];
const ANNUAL = ['04-05'];

const dv = (name, o = {}) => ({ name: `DV ${name}`, strategy: 'deepValue', ...o });
const q = (name, o = {}) => ({ name: `Q ${name}`, strategy: 'qualidade', ...o });
const div = (name, o = {}) => ({ name: `DIV ${name}`, strategy: 'dividendos', ...o });

// Quality: hold while the business is still good and not expensive (P/L up to 25), instead of
// selling as soon as P/L crosses 15 (which sold the winners).
const qualityKeep = { strategy: 'qualidade', criteria: { maxPriceToEarnings: 25 }, prefilterName: 'keep25' };

module.exports = [
    dv('top10 trimestral (atual)'),
    dv('top20 trimestral', { size: 20 }),
    dv('top20 semestral', { size: 20, anchors: SEMIANNUAL }),
    dv('top20 anual', { size: 20, anchors: ANNUAL }),
    dv('top20 + lucro 3a', { size: 20, prefilter: consistentProfit, prefilterName: 'profit' }),
    dv('top20 + MM200', { size: 20, prefilter: aboveMa200, prefilterName: 'ma200' }),
    dv('top20 + lucro 3a + MM200', { size: 20, prefilter: both(consistentProfit, aboveMa200), prefilterName: 'profit+ma200' }),
    dv('top20 fórmula mágica', { size: 20, criteria: { sort: 'magicFormula' } }),
    dv('top20 fórm. mágica + lucro 3a', { size: 20, criteria: { sort: 'magicFormula' }, prefilter: consistentProfit, prefilterName: 'profit' }),

    q('top10 trimestral (atual)'),
    q('top20 trimestral', { size: 20 }),
    q('top20 + manter até P/L 25', { size: 20, keep: qualityKeep }),
    q('top20 + lucro estável', { size: 20, prefilter: stableProfit, prefilterName: 'stable' }),
    q('top20 sem commodities', { size: 20, prefilter: noCommodities, prefilterName: 'nocommod' }),
    q('top20 estável + manter P/L 25', { size: 20, prefilter: stableProfit, prefilterName: 'stable', keep: { ...qualityKeep, prefilter: stableProfit, prefilterName: 'keep25stable' } }),
    q('top20 fórmula mágica', { size: 20, criteria: { sort: 'magicFormula' } }),
    q('top20 estável + manter + MM200', { size: 20, prefilter: both(stableProfit, aboveMa200), prefilterName: 'stable+ma200', keep: { ...qualityKeep, prefilter: stableProfit, prefilterName: 'keep25stable' } }),

    div('top10 trimestral (atual)'),
    div('top20 trimestral', { size: 20 }),
];
