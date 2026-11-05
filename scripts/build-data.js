// Builds data/stocks.json from CVM open data (fundamentals) + Yahoo Finance (market data).
// Run: npm run build:data  (runs daily via .github/workflows/update-data.yml)
const fs = require('fs');
const path = require('path');
const { loadFundamentals } = require('../cvm');
const { getMarketData } = require('../yahoo');

const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const CONCURRENCY = 4;

const round = (v, digits = 2) =>
    v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits;
const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const pct = (a, b) => { const r = ratio(a, b); return r == null ? null : r * 100; };

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }));
    return results;
}

function marketCap(company, market) {
    const priced = company.tickers.filter(t => market[t.ticker]);
    const priceOf = classe => {
        const prices = priced.filter(t => t.classe === classe).map(t => market[t.ticker].price);
        return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    };
    const fallback = priceOf('ON') ?? priceOf('PN');
    if (fallback == null) return null; // only units trade: can't price the share classes
    const cap = company.acoes.on * (priceOf('ON') ?? fallback) + company.acoes.pn * (priceOf('PN') ?? fallback);
    return cap * shareCountScale(company, cap);
}

// CVM's "composição do capital" has no unit column: some companies report the number of shares
// in units, others in thousands (e.g. Ambev, Vale, Itaú). Pick the scale that gives a plausible
// P/VP (or P/Receita when equity is not positive).
function shareCountScale(company, cap) {
    const plausible = (base, min, max) => {
        if (!(base > 0)) return null;
        const asIs = cap / base;
        if (asIs >= min) return 1;
        return cap * 1000 / base <= max ? 1000 : 1;
    };
    return plausible(company.patrimonio, 0.05, 100) ?? plausible(company.receita, 0.01, 200) ?? 1;
}

function toStock(company, ticker, m, cap) {
    const ev = company.dividaLiquida == null ? null : cap + company.dividaLiquida;
    return {
        'Ativo': ticker,
        'Empresa': company.empresa,
        'Cotação': round(m.price),
        'P/L': round(ratio(cap, company.lucro)),
        'P/VP': round(ratio(cap, company.patrimonio)),
        'PSR': round(ratio(cap, company.receita)),
        'Dividend Yield': round(pct(m.dividendos12m, m.price)),
        'P/EBIT': round(ratio(cap, company.ebit)),
        'EV/EBIT': round(ratio(ev, company.ebit)),
        'Margem Ebit': round(pct(company.ebit, company.receita)),
        'Margem Líquida': round(pct(company.lucro, company.receita)),
        'ROE': round(pct(company.lucro, company.patrimonio)),
        'Dívida Líquida/Patrimônio': round(ratio(company.dividaLiquida, company.patrimonio)),
        'Dívida Líquida/EBIT': round(ratio(company.dividaLiquida, company.ebit)),
        'Liquidez Média Diária': round(m.liquidezMediaDiaria, 0),
        'Data Balanço': company.dataBalanco,
        'MA5': round(m.MA5),
        'MA10': round(m.MA10),
        'MA20': round(m.MA20),
        'MMA50': round(m.MMA50),
        'MA100': round(m.MA100),
        'MA200': round(m.MA200),
    };
}

async function main() {
    const companies = await loadFundamentals();
    const allTickers = companies.flatMap(c => c.tickers.map(t => t.ticker));
    console.log(`${companies.length} companies with CVM statements, ${allTickers.length} tickers`);

    const market = {};
    let failures = 0;
    await mapWithConcurrency(allTickers, CONCURRENCY, async ticker => {
        try {
            const m = await getMarketData(ticker);
            if (m) market[ticker] = m;
        } catch (e) {
            failures++;
            console.log(`yahoo failed for ${ticker}: ${e.message}`);
        }
    });
    console.log(`market data for ${Object.keys(market).length} tickers (${failures} errors)`);

    const stocks = [];
    for (const company of companies) {
        const cap = marketCap(company, market);
        if (cap == null) continue;
        for (const { ticker } of company.tickers) {
            if (market[ticker]) stocks.push(toStock(company, ticker, market[ticker], cap));
        }
    }

    if (stocks.length < 100) {
        throw new Error(`only ${stocks.length} stocks built; refusing to overwrite ${OUTPUT}`);
    }

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify({
        updatedAt: new Date().toISOString(),
        sources: ['CVM dados abertos (DFP/ITR/FCA)', 'Yahoo Finance'],
        stocks: stocks.sort((a, b) => a.Ativo.localeCompare(b.Ativo)),
    }, null, 1));
    console.log(`wrote ${stocks.length} stocks to ${OUTPUT}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
