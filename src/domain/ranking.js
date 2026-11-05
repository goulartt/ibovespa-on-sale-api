const _ = require('lodash');
const { RECUPERACAO_JUDICIAL } = require('./recuperacaoJudicial');

// "Ibovespa em promoção": liquid, profitable companies paying > 6% dividend yield,
// ranked by the cheapest EV/EBIT, one ticker per company.
const DEFAULT_CRITERIA = Object.freeze({
    minLiquidity: 1_000_000,
    minEbitMargin: 0,
    minDividendYield: 6,
    limit: 50,
    excludedTickers: RECUPERACAO_JUDICIAL,
});

function rankStocks(stocks, criteria = {}) {
    const c = { ...DEFAULT_CRITERIA, ...criteria };
    const excluded = new Set(c.excludedTickers);

    const eligible = stocks.filter(stock =>
        stock['Liquidez Média Diária'] > c.minLiquidity &&
        stock['Margem Ebit'] > c.minEbitMargin &&
        stock['Dividend Yield'] > c.minDividendYield &&
        stock['EV/EBIT'] != null &&
        !excluded.has(stock.Ativo));

    // Cheapest first; for the same company keep its most liquid ticker.
    const sorted = _.orderBy(eligible, ['EV/EBIT', 'Liquidez Média Diária'], ['asc', 'desc']);
    return _.uniqBy(sorted, stock => stock.Empresa)
        .slice(0, c.limit)
        .map((stock, index) => ({ Ranking: index + 1, ...stock }));
}

module.exports = { rankStocks, DEFAULT_CRITERIA };
