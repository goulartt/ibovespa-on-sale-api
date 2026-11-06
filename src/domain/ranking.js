const _ = require('lodash');

const isNumber = v => typeof v === 'number' && Number.isFinite(v);


function hasConsistentProfit(stock, minYears) {
    const years = stock['Lucros Anuais'];
    return Array.isArray(years) &&
        years.length >= minYears &&
        years.every(y => y.lucro > 0) &&
        stock['P/L'] > 0;
}

// Rules shared by every strategy: liquid, operating normally, has an EV/EBIT to sort by.
const COMMON_DEFAULTS = {
    minLiquidity: 1_000_000,
    limit: 50,
    sort: 'evEbit',
    excludedTickers: [], // manual overrides, if ever needed
};

const isTradableAndHealthy = (stock, c) =>
    stock['Liquidez Média Diária'] > c.minLiquidity &&
    !stock['Situação'] &&
    isNumber(stock['EV/EBIT']);

// EBIT/EV ("earnings yield"): the higher, the cheaper. Falls back to 1 / (EV/EBIT) for datasets
// built before the field existed. Companies with a negative EV end up last.
const earningsYield = s =>
    isNumber(s['EBIT/EV']) ? s['EBIT/EV'] : (s['EV/EBIT'] > 0 ? 100 / s['EV/EBIT'] : -Infinity);

const STRATEGIES = {
    // "Deep Value": the cheapest companies by EBIT/EV, with only the basic filters
    // (liquidity, positive EBIT, no banks/insurers, no judicial recovery). Banks filed in the
    // banking format have no EBIT anyway; this also drops insurers and financial holdings that file
    // in the industrial format (Porto Seguro, Caixa Seguridade, Itaúsa...).
    deepValue: {
        defaults: {},
        isEligible: stock => stock['Margem Ebit'] > 0 && !stock['Instituição Financeira'],
    },

    // "Dividendos sustentáveis": cheap companies whose dividends look sustainable.
    // - DY > 6% in the last 12 months and > 5% on the 5-year average (one-off special dividends
    //   don't count);
    // - payout <= 120% (dividends paid now often refer to the previous year's profit),
    //   dividends in at least 3 of the last 5 years;
    // - positive EBIT margin, net debt < 3x EBIT (4.5x for regulated utilities);
    // - profit in every recent annual statement (min. 3 years) and in the last 12 months.
    dividendos: {
        defaults: {
            minEbitMargin: 0,
            minDividendYield: 6,
            minDividendYield5y: 5,
            maxPayout: 120,
            minDividendYears: 3,
            maxNetDebtToEbit: 3,
            maxNetDebtToEbitBySector: { 'Energia e saneamento': 4.5 },
            minProfitYears: 3,
        },
        isEligible: (stock, c) =>
            stock['Margem Ebit'] > c.minEbitMargin &&
            stock['Dividend Yield'] > c.minDividendYield &&
            stock['DY Médio 5 Anos'] > c.minDividendYield5y &&
            isNumber(stock.Payout) && stock.Payout > 0 && stock.Payout <= c.maxPayout &&
            stock['Anos com Dividendos'] >= c.minDividendYears &&
            isNumber(stock['Dívida Líquida/EBIT']) &&
            stock['Dívida Líquida/EBIT'] < (c.maxNetDebtToEbitBySector[stock.Setor] ?? c.maxNetDebtToEbit) &&
            hasConsistentProfit(stock, c.minProfitYears),
    },

    // "Qualidade a bom preço" (value investing + quality + financial strength):
    // - ROCE > 15%: EBIT / average capital employed (equity + non-current liabilities);
    // - net debt < 1.5x EBITDA (net cash is even better);
    // - P/L between 0 and 15 (a ~25% discount to a 20x market multiple).
    qualidade: {
        defaults: {
            minRoce: 15,
            maxNetDebtToEbitda: 1.5,
            maxPriceToEarnings: 15,
        },
        isEligible: (stock, c) =>
            isNumber(stock.ROCE) && stock.ROCE > c.minRoce &&
            isNumber(stock['Dívida Líquida/EBITDA']) && stock['Dívida Líquida/EBITDA'] < c.maxNetDebtToEbitda &&
            stock['P/L'] > 0 && stock['P/L'] <= c.maxPriceToEarnings,
    },
};

const STRATEGY_NAMES = Object.keys(STRATEGIES);
const SORTS = ['evEbit', 'magicFormula'];

// Kept for backwards compatibility: the default (dividend) strategy's criteria.
const DEFAULT_CRITERIA = Object.freeze({ ...COMMON_DEFAULTS, ...STRATEGIES.dividendos.defaults });

// Greenblatt's "magic formula": cheapest (EBIT/EV) + best return on capital (ROIC), by position.
function sortByMagicFormula(stocks) {
    const position = sorted => new Map(sorted.map((s, i) => [s.Ativo, i]));
    const byEv = position(_.orderBy(stocks, [earningsYield], ['desc']));
    const byRoic = position(_.orderBy(stocks, [s => (isNumber(s.ROIC) ? s.ROIC : -Infinity)], ['desc']));
    return _.orderBy(stocks, [s => byEv.get(s.Ativo) + byRoic.get(s.Ativo), earningsYield], ['asc', 'desc']);
}

function rankStocks(stocks, { strategy = 'dividendos', ...criteria } = {}) {
    const definition = STRATEGIES[strategy];
    if (!definition) throw new RangeError(`unknown strategy "${strategy}"`);
    const c = { ...COMMON_DEFAULTS, ...definition.defaults, ...criteria };
    if (!SORTS.includes(c.sort)) throw new RangeError(`unknown sort "${c.sort}"`);
    const excluded = new Set(c.excludedTickers);

    const eligible = stocks.filter(s =>
        isTradableAndHealthy(s, c) && definition.isEligible(s, c) && !excluded.has(s.Ativo));

    // One ticker per company: the most liquid one.
    const unique = _.uniqBy(_.orderBy(eligible, ['Liquidez Média Diária'], ['desc']), s => s.Empresa);

    const sorted = c.sort === 'magicFormula'
        ? sortByMagicFormula(unique)
        : _.orderBy(unique, [earningsYield, 'Liquidez Média Diária'], ['desc', 'desc']);

    return sorted.slice(0, c.limit).map((stock, index) => ({ Ranking: index + 1, ...stock }));
}

module.exports = { rankStocks, DEFAULT_CRITERIA, SORTS, STRATEGY_NAMES };
