// Downloads everything the research backtests need once and saves it with v8.serialize, so
// experiments run in seconds. Usage: node scripts/research/build-cache.js <cache-file> [fromYear]
const fs = require('fs');
const v8 = require('v8');
const { loadHistory } = require('../../src/sources/cvm');
const { loadRegistry } = require('../../src/sources/cvmRegistry');
const { fetchHistory } = require('../../src/sources/yahoo');
const { fetchCdi } = require('../../src/sources/benchmarks');
const { mapWithConcurrency } = require('../../src/lib/concurrency');
const { logger } = require('../../src/lib/logger');

async function main() {
    const [file, fromYearArg] = process.argv.slice(2);
    if (!file) throw new Error('usage: build-cache.js <cache-file> [fromYear]');
    const fromYear = Number(fromYearArg || 2014);
    const pricesFrom = `${fromYear - 6}-01-01`;

    const registry = await loadRegistry();
    const { companies, tickers, capital } = await loadHistory({ fromYear });
    const allTickers = [...new Set([...tickers.values()].flatMap(t => t.tickers.map(x => x.ticker)))];
    logger.info(`${companies.size} companies, ${allTickers.length} tickers`);

    const histories = {};
    let failures = 0;
    await mapWithConcurrency(allTickers, 4, async ticker => {
        try {
            const h = await fetchHistory(ticker, { from: pricesFrom });
            if (h) histories[ticker] = h;
        } catch (e) {
            failures++;
        }
    });
    logger.info(`histories for ${Object.keys(histories).length}/${allTickers.length} tickers (${failures} errors)`);

    const ibov = await fetchHistory('IBOV', { from: pricesFrom, symbol: '^BVSP' });
    const today = ibov.days[ibov.days.length - 1].date;
    const cdiRates = await fetchCdi({ from: `${fromYear - 1}-12-01`, to: today });

    fs.writeFileSync(file, v8.serialize({ fromYear, companies, tickers, capital, registry, histories, ibov, cdiRates }));
    logger.info(`wrote ${file} (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);
}

main().catch(e => {
    logger.error(e);
    process.exit(1);
});
