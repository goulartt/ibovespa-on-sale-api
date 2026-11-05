const _ = require('lodash');

// "Ibovespa em promoção": cheap companies whose dividends look sustainable.
//
// A stock enters the ranking when it:
// - trades more than R$ 1 mi/day and has a positive EBIT margin;
// - is operating normally (not in judicial/extrajudicial recovery, bankruptcy or liquidation);
// - has a sustainable dividend yield above 6%: the lower of the last-12-months yield and the
//   5-year average yield, so one-off special dividends don't count;
// - pays out at most 100% of its net income;
// - paid dividends in at least 3 of the last 5 years;
// - has net debt below 3x EBIT;
// - made a profit in each of the last annual statements (at least 3 years of history) and in
//   the last 12 months.
const DEFAULT_CRITERIA = Object.freeze({
    minLiquidity: 1_000_000,
    minEbitMargin: 0,
    minDividendYield: 6,
    maxPayout: 100,
    minDividendYears: 3,
    maxNetDebtToEbit: 3,
    minProfitYears: 3,
    limit: 50,
    sort: 'evEbit',
    excludedTickers: [], // manual overrides, if ever needed
});

const SORTS = ['evEbit', 'magicFormula'];

const isNumber = v => typeof v === 'number' && Number.isFinite(v);

const sustainableDividendYield = stock =>
    isNumber(stock['Dividend Yield']) && isNumber(stock['DY Médio 5 Anos'])
        ? Math.min(stock['Dividend Yield'], stock['DY Médio 5 Anos'])
        : null;

function hasConsistentProfit(stock, minYears) {
    const years = stock['Lucros Anuais'];
    return Array.isArray(years) &&
        years.length >= minYears &&
        years.every(y => y.lucro > 0) &&
        stock['P/L'] > 0;
}

function isEligible(stock, c, excluded) {
    return stock['Liquidez Média Diária'] > c.minLiquidity &&
        stock['Margem Ebit'] > c.minEbitMargin &&
        isNumber(stock['EV/EBIT']) &&
        !stock['Situação'] &&
        sustainableDividendYield(stock) > c.minDividendYield &&
        isNumber(stock.Payout) && stock.Payout > 0 && stock.Payout <= c.maxPayout &&
        stock['Anos com Dividendos'] >= c.minDividendYears &&
        isNumber(stock['Dívida Líquida/EBIT']) && stock['Dívida Líquida/EBIT'] < c.maxNetDebtToEbit &&
        hasConsistentProfit(stock, c.minProfitYears) &&
        !excluded.has(stock.Ativo);
}

// Greenblatt's "magic formula": cheapest (EV/EBIT) + best return on capital (ROIC), by position.
function sortByMagicFormula(stocks) {
    const position = (sorted) => new Map(sorted.map((s, i) => [s.Ativo, i]));
    const byEv = position(_.orderBy(stocks, ['EV/EBIT'], ['asc']));
    const byRoic = position(_.orderBy(stocks, [s => (isNumber(s.ROIC) ? s.ROIC : -Infinity)], ['desc']));
    return _.orderBy(stocks, [s => byEv.get(s.Ativo) + byRoic.get(s.Ativo), 'EV/EBIT'], ['asc', 'asc']);
}

function rankStocks(stocks, criteria = {}) {
    const c = { ...DEFAULT_CRITERIA, ...criteria };
    if (!SORTS.includes(c.sort)) throw new RangeError(`unknown sort "${c.sort}"`);
    const excluded = new Set(c.excludedTickers);

    // One ticker per company: the most liquid one.
    const eligible = _.uniqBy(
        _.orderBy(stocks.filter(s => isEligible(s, c, excluded)), ['Liquidez Média Diária'], ['desc']),
        s => s.Empresa);

    const sorted = c.sort === 'magicFormula'
        ? sortByMagicFormula(eligible)
        : _.orderBy(eligible, ['EV/EBIT', 'Liquidez Média Diária'], ['asc', 'desc']);

    return sorted.slice(0, c.limit).map((stock, index) => ({ Ranking: index + 1, ...stock }));
}

module.exports = { rankStocks, DEFAULT_CRITERIA, SORTS, sustainableDividendYield };
