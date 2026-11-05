const _ = require('lodash');

// "Ibovespa em promoção": liquid, profitable companies paying > 6% dividend yield, operating
// normally (not in judicial/extrajudicial recovery, bankruptcy or liquidation according to the
// CVM registry), ranked by the cheapest EV/EBIT, one ticker per company.
const DEFAULT_CRITERIA = Object.freeze({
    minLiquidity: 1_000_000,
    minEbitMargin: 0,
    minDividendYield: 6,
    limit: 50,
    excludedTickers: [], // manual overrides, if ever needed
});

function rankStocks(stocks, criteria = {}) {
    const c = { ...DEFAULT_CRITERIA, ...criteria };
    const excluded = new Set(c.excludedTickers);

    const eligible = stocks.filter(stock =>
        stock['Liquidez Média Diária'] > c.minLiquidity &&
        stock['Margem Ebit'] > c.minEbitMargin &&
        stock['Dividend Yield'] > c.minDividendYield &&
        stock['EV/EBIT'] != null &&
        !stock['Situação'] &&
        !excluded.has(stock.Ativo));

    // Cheapest first; for the same company keep its most liquid ticker.
    const sorted = _.orderBy(eligible, ['EV/EBIT', 'Liquidez Média Diária'], ['asc', 'desc']);
    return _.uniqBy(sorted, stock => stock.Empresa)
        .slice(0, c.limit)
        .map((stock, index) => ({ Ranking: index + 1, ...stock }));
}

module.exports = { rankStocks, DEFAULT_CRITERIA };
