// Turns company fundamentals (CVM) + market data (Yahoo) into the indicators served by the API.
// Units follow the original Status Invest format: percentages as 0-100 numbers, money in BRL.

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

// Company market cap = ON shares x ON price + PN shares x average PN price.
// `prices` maps ticker -> price. Returns null when no ON/PN ticker has a price (e.g. only units trade).
function marketCap(company, prices) {
    const priceOf = classe => average(company.tickers
        .filter(t => t.classe === classe && prices[t.ticker] != null)
        .map(t => prices[t.ticker]));
    const on = priceOf('ON');
    const pn = priceOf('PN');
    const fallback = on ?? pn;
    if (fallback == null) return null;
    const raw = company.acoes.on * (on ?? fallback) + company.acoes.pn * (pn ?? fallback);
    return raw * shareCountScale(company, raw);
}

function buildStock(company, ticker, market, cap) {
    const ev = company.dividaLiquida == null ? null : cap + company.dividaLiquida;
    return {
        'Ativo': ticker,
        'Empresa': company.empresa,
        'Cotação': round(market.price),
        'P/L': round(ratio(cap, company.lucro)),
        'P/VP': round(ratio(cap, company.patrimonio)),
        'PSR': round(ratio(cap, company.receita)),
        'Dividend Yield': round(percent(market.dividendos12m, market.price)),
        'P/EBIT': round(ratio(cap, company.ebit)),
        'EV/EBIT': round(ratio(ev, company.ebit)),
        'Margem Ebit': round(percent(company.ebit, company.receita)),
        'Margem Líquida': round(percent(company.lucro, company.receita)),
        'ROE': round(percent(company.lucro, company.patrimonio)),
        'Dívida Líquida/Patrimônio': round(ratio(company.dividaLiquida, company.patrimonio)),
        'Dívida Líquida/EBIT': round(ratio(company.dividaLiquida, company.ebit)),
        'Liquidez Média Diária': round(market.liquidezMediaDiaria, 0),
        'Data Balanço': company.dataBalanco,
        'Situação': company.situacao ?? null,
        'MA5': round(market.MA5),
        'MA10': round(market.MA10),
        'MA20': round(market.MA20),
        'MMA50': round(market.MMA50),
        'MA100': round(market.MA100),
        'MA200': round(market.MA200),
    };
}

// Builds one stock per traded ticker of each company that has market data.
function buildStocks(companies, marketByTicker) {
    const prices = Object.fromEntries(Object.entries(marketByTicker).map(([t, m]) => [t, m.price]));
    const stocks = [];
    for (const company of companies) {
        const cap = marketCap(company, prices);
        if (cap == null) continue;
        for (const { ticker } of company.tickers) {
            if (marketByTicker[ticker]) stocks.push(buildStock(company, ticker, marketByTicker[ticker], cap));
        }
    }
    return stocks.sort((a, b) => a.Ativo.localeCompare(b.Ativo));
}

module.exports = { round, ratio, percent, average, shareCountScale, marketCap, buildStock, buildStocks };
