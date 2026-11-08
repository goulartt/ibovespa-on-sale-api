// Turns company fundamentals (CVM) + market data (Yahoo) into the indicators served by the API.
// Units follow the original Status Invest format: percentages as 0-100 numbers, money in BRL.

const { intrinsicValue, profitVariation, safetyMargin } = require('./intrinsicValue');

const round = (value, digits = 2) => {
    if (value == null || !Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

const percent = (a, b) => {
    const r = ratio(a, b);
    return r == null ? null : r * 100;
};

const average = values => (values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length);

// CVM's "composição do capital" has no unit column: some companies report the number of shares
// in units, others in thousands (e.g. Ambev, Vale, Itaú). A P/VP below 0.05 (or P/Receita below
// 0.01 when equity is not positive) is not a real valuation, so the count must be in thousands.
const MIN_PLAUSIBLE = { priceToBook: 0.05, priceToSales: 0.01 };

function shareCountScale({ patrimonio, receita }, rawMarketCap) {
    const scaleBy = (base, min) => (base > 0 ? (rawMarketCap / base < min ? 1000 : 1) : null);
    return scaleBy(patrimonio, MIN_PLAUSIBLE.priceToBook) ?? scaleBy(receita, MIN_PLAUSIBLE.priceToSales) ?? 1;
}

// Company market cap = ON shares x ON price + PN shares x average PN price, and the total number
// of shares. `prices` maps ticker -> price. Returns null when no ON/PN ticker has a price.
function capitalization(company, prices) {
    const priceOf = classe => average(company.tickers
        .filter(t => t.classe === classe && prices[t.ticker] != null)
        .map(t => prices[t.ticker]));
    const on = priceOf('ON');
    const pn = priceOf('PN');
    const fallback = on ?? pn;
    if (fallback == null) return null;
    const raw = company.acoes.on * (on ?? fallback) + company.acoes.pn * (pn ?? fallback);
    const scale = shareCountScale(company, raw);
    return { cap: raw * scale, shares: (company.acoes.on + company.acoes.pn) * scale };
}

function marketCap(company, prices) {
    return capitalization(company, prices)?.cap ?? null;
}

// Décio Bazin's price ceiling: the price at which the average dividend of the last 5 years
// yields the 6% a year he required.
const BAZIN_YIELD = 6;

function bazinFields(market) {
    const ceiling = market.dividendosMedia5a > 0 ? market.dividendosMedia5a / (BAZIN_YIELD / 100) : null;
    return {
        'Preço Teto Bazin': round(ceiling),
        'Desconto Bazin': ceiling && market.price > 0 ? round(((ceiling - market.price) / ceiling) * 100) : null,
    };
}

// Intrinsic value fields for one ticker (null when the method doesn't apply or no rates).
function valuationFields(company, market, cap, rates) {
    const years = company.lucrosAnuais || [];
    const avgProfit = average(years.map(y => y.lucro));
    // Average payout: this ticker's 5-year average dividend yield x market cap / average annual
    // profit (a yield works for units and every share class alike).
    const payoutMedio = avgProfit > 0 && market.dividendosMedia5a != null && market.price > 0
        ? ((market.dividendosMedia5a / market.price) * cap) / avgProfit
        : null;
    const v = rates ? intrinsicValue({
        lucro: company.lucro, roeMedio: company.roeMedio, payoutMedio, valorMercado: cap, preco: market.price,
    }, rates) : null;
    const variation = profitVariation(years.map(y => y.lucro));
    const margin = v ? safetyMargin(variation) : null;
    return {
        'Valor Intrínseco': round(v?.precoTeto),
        // buy price: intrinsic value minus a margin of safety that grows with profit variation
        'Preço Teto': margin == null ? null : round(v.precoTeto * (1 - margin / 100)),
        'Margem de Segurança': margin,
        'Variação do Lucro': variation == null ? null : round(variation * 100),
        'Desconto': round(v?.desconto),
        'ROE Médio': company.roeMedio == null ? null : round(company.roeMedio * 100),
        'Payout Médio': payoutMedio == null ? null : round(Math.min(Math.max(payoutMedio, 0), 1) * 100),
        'Crescimento Esperado': round(v?.crescimento),
        'Lucro Líquido': round(company.lucro, 0),
    };
}

function buildStock(company, ticker, market, cap, { rates = null } = {}) {
    const ev = company.dividaLiquida == null ? null : cap + company.dividaLiquida;
    const investedCapital = company.patrimonio == null || company.dividaLiquida == null ? null : company.patrimonio + company.dividaLiquida;
    // Share of the (company-level) net income paid out, based on this ticker's dividends.
    const payout = company.lucro > 0 && market.price > 0 ? percent((market.dividendos12m / market.price) * cap, company.lucro) : null;
    const lucrosAnuais = company.lucrosAnuais || [];
    return {
        'Ativo': ticker,
        'Empresa': company.empresa,
        'Setor': company.setor ?? null,
        'Cotação': round(market.price),
        'P/L': round(ratio(cap, company.lucro)),
        'P/VP': round(ratio(cap, company.patrimonio)),
        'PSR': round(ratio(cap, company.receita)),
        'Dividend Yield': round(percent(market.dividendos12m, market.price)),
        'DY Médio 5 Anos': round(percent(market.dividendosMedia5a, market.price)),
        'Anos com Dividendos': market.anosComDividendos ?? null,
        'Payout': round(payout),
        'P/EBIT': round(ratio(cap, company.ebit)),
        'EV/EBIT': round(ratio(ev, company.ebit)),
        'EBIT/EV': round(percent(company.ebit, ev)),
        'Margem Ebit': round(percent(company.ebit, company.receita)),
        'Margem Líquida': round(percent(company.lucro, company.receita)),
        'ROE': round(percent(company.lucro, company.patrimonio)),
        'ROIC': investedCapital > 0 ? round(percent(company.ebit, investedCapital)) : null,
        'ROCE': company.capitalEmpregado > 0 ? round(percent(company.ebit, company.capitalEmpregado)) : null,
        'Dívida Líquida/Patrimônio': round(ratio(company.dividaLiquida, company.patrimonio)),
        'Dívida Líquida/EBIT': round(ratio(company.dividaLiquida, company.ebit)),
        'Dívida Líquida/EBITDA': company.ebitda > 0 ? round(ratio(company.dividaLiquida, company.ebitda)) : null,
        'Liquidez Média Diária': round(market.liquidezMediaDiaria, 0),
        'Lucros Anuais': lucrosAnuais.map(({ ano, lucro }) => ({ ano, lucro: round(lucro, 0) })),
        'Anos com Lucro': lucrosAnuais.filter(y => y.lucro > 0).length,
        'Data Balanço': company.dataBalanco,
        'Situação': company.situacao ?? null,
        // bank/insurer by statement format or by CVM sector
        'Instituição Financeira': Boolean(company.financeira || company.instituicaoFinanceira),
        ...valuationFields(company, market, cap, rates),
        ...bazinFields(market),
        'MA5': round(market.MA5),
        'MA10': round(market.MA10),
        'MA20': round(market.MA20),
        'MMA50': round(market.MMA50),
        'MA100': round(market.MA100),
        'MA200': round(market.MA200),
    };
}

// Builds one stock per traded ticker of each company that has market data. `rates`
// ({ taxaFinal } in %) enables the intrinsic value fields.
function buildStocks(companies, marketByTicker, { rates = null } = {}) {
    const prices = Object.fromEntries(Object.entries(marketByTicker).map(([t, m]) => [t, m.price]));
    const stocks = [];
    for (const company of companies) {
        const cap = marketCap(company, prices);
        if (cap == null) continue;
        for (const { ticker } of company.tickers) {
            if (marketByTicker[ticker]) stocks.push(buildStock(company, ticker, marketByTicker[ticker], cap, { rates }));
        }
    }
    return stocks.sort((a, b) => a.Ativo.localeCompare(b.Ativo));
}

module.exports = { BAZIN_YIELD, round, ratio, percent, average, shareCountScale, marketCap, capitalization, buildStock, buildStocks };
