// Builds data/stocks.json from CVM open data (fundamentals) + Yahoo Finance (market data).
// Run: npm run build:data  (runs on weekdays via .github/workflows/update-data.yml)
const fs = require('fs');
const path = require('path');
const { loadFundamentals } = require('../src/sources/cvm');
const { loadRegistry } = require('../src/sources/cvmRegistry');
const { getMarketData } = require('../src/sources/yahoo');
const { buildStocks } = require('../src/domain/indicators');
const { mapWithConcurrency } = require('../src/lib/concurrency');
const { logger } = require('../src/lib/logger');

const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const CONCURRENCY = 4;
const MIN_STOCKS = 100; // sanity check: never overwrite good data with a broken run
const MAX_MARKET_FAILURE_RATIO = 0.2;

async function fetchMarketData(tickers) {
    const market = {};
    let failures = 0;
    await mapWithConcurrency(tickers, CONCURRENCY, async ticker => {
        try {
            const m = await getMarketData(ticker);
            if (m) market[ticker] = m;
        } catch (e) {
            failures++;
            logger.warn(`yahoo failed for ${ticker}: ${e.message}`);
        }
    });
    if (failures / tickers.length > MAX_MARKET_FAILURE_RATIO) {
        throw new Error(`Yahoo failed for ${failures}/${tickers.length} tickers`);
    }
    logger.info(`market data for ${Object.keys(market).length} tickers (${failures} errors)`);
    return market;
}

function writeAtomically(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
}

async function main() {
    const registry = await loadRegistry();
    const companies = (await loadFundamentals()).map(c => {
        const info = registry.get(c.cnpj);
        return {
            ...c,
            situacao: info?.situacao ?? null,
            setor: info?.setor ?? null,
            // banks/insurers filed in the industrial format: drop the EBIT-based figures
            ...(info?.financeira && { financeira: true, ebit: null, ebitda: null, dividaLiquida: null, capitalEmpregado: null }),
        };
    });
    logger.info(`${companies.filter(c => c.situacao).length} listed companies in a distressed situation (CVM registry)`);
    const tickers = companies.flatMap(c => c.tickers.map(t => t.ticker));
    logger.info(`${companies.length} companies with CVM statements, ${tickers.length} tickers`);

    const stocks = buildStocks(companies, await fetchMarketData(tickers));
    if (stocks.length < MIN_STOCKS) {
        throw new Error(`only ${stocks.length} stocks built; refusing to overwrite ${OUTPUT}`);
    }

    writeAtomically(OUTPUT, JSON.stringify({
        updatedAt: new Date().toISOString(),
        sources: ['CVM dados abertos (DFP/ITR/FCA)', 'Yahoo Finance'],
        stocks,
    }, null, 1));
    logger.info(`wrote ${stocks.length} stocks to ${OUTPUT}`);
}

main().catch(e => {
    logger.error(e);
    process.exit(1);
});
