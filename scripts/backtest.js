// Backtest of the top 10 of each strategy since 2023, 2024 and 2025 against the CDI and the
// Ibovespa, buy-and-hold and with quarterly rotation. Writes data/backtest.json.
// Run: npm run backtest  (on demand / monthly via .github/workflows/backtest.yml)
const path = require('path');
const { loadHistory } = require('../src/sources/cvm');
const { loadRegistry } = require('../src/sources/cvmRegistry');
const { fetchHistory, adjCloseOn } = require('../src/sources/yahoo');
const { fetchCdi } = require('../src/sources/benchmarks');
const { createRanker } = require('../src/backtest/pointInTime');
const {
    simulate, rebalanceDates, cdiIndex, summarizeSeries, yearlyReturns, sampleCurve, MODES,
} = require('../src/backtest/engine');
const { STRATEGY_NAMES } = require('../src/domain/ranking');
const { mapWithConcurrency } = require('../src/lib/concurrency');
const { logger } = require('../src/lib/logger');
const { writeAtomically } = require('../src/lib/files');

const OUTPUT = path.join(__dirname, '..', 'data', 'backtest.json');
const START_YEARS = [2023, 2024, 2025];
const PRICES_FROM = '2017-01-01'; // 5 years of dividends before the first start + moving averages
const PARAMS = { size: 10, buffer: 20, cost: 0.001, maxStaleDays: 10 };
const MAX_HISTORY_FAILURE_RATIO = 0.3;

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const roundAll = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round(v)]));

async function fetchHistories(tickers) {
    const histories = {};
    let failures = 0;
    await mapWithConcurrency(tickers, 4, async ticker => {
        try {
            const h = await fetchHistory(ticker, { from: PRICES_FROM });
            if (h) histories[ticker] = h;
        } catch (e) {
            failures++;
            logger.warn(`yahoo history failed for ${ticker}: ${e.message}`);
        }
    });
    if (failures / tickers.length > MAX_HISTORY_FAILURE_RATIO) {
        throw new Error(`Yahoo failed for ${failures}/${tickers.length} tickers`);
    }
    logger.info(`price history for ${Object.keys(histories).length}/${tickers.length} tickers (${failures} errors)`);
    return histories;
}

async function main() {
    const registry = await loadRegistry();
    const { companies, tickers } = await loadHistory({ fromYear: START_YEARS[0] });
    const allTickers = [...new Set([...tickers.values()].flatMap(t => t.tickers.map(x => x.ticker)))];
    logger.info(`${companies.size} companies with CVM statements, ${allTickers.length} tickers`);

    const histories = await fetchHistories(allTickers);
    const ibov = await fetchHistory('IBOV', { from: PRICES_FROM, symbol: '^BVSP' });
    if (!ibov) throw new Error('no Ibovespa history');
    const calendar = ibov.days.map(d => d.date);
    const today = calendar[calendar.length - 1];
    const cdi = cdiIndex(calendar, await fetchCdi({ from: `${START_YEARS[0] - 1}-12-01`, to: today }));
    const ibovOn = new Map(ibov.days.map(d => [d.date, d.adj]));

    const ranker = createRanker({ companies, tickers, registry, histories });
    const priceOn = (ticker, day) => adjCloseOn(histories[ticker], day);

    const starts = [];
    for (const year of START_YEARS) {
        const start = calendar.find(d => d >= `${year}-01-01`);
        const days = calendar.filter(d => d >= start);
        const cdiValues = days.map(d => [d, cdi.get(d)]);
        const ibovValues = days.map(d => [d, ibovOn.get(d)]);
        const rebalanceOn = rebalanceDates(calendar, start, today);

        const runs = {};
        for (const strategy of STRATEGY_NAMES) {
            runs[strategy] = {};
            for (const mode of MODES) {
                const result = simulate({
                    calendar, start, end: today, cdi, priceOn, mode, rebalanceOn, ...PARAMS,
                    rankAt: asOf => ranker.rankAt(asOf, strategy),
                });
                const m = summarizeSeries(result.values, cdiValues);
                runs[strategy][mode] = {
                    metricas: { ...roundAll(m), operacoes: result.trades.reduce((n, t) => n + t.sold.length + t.bought.length, 0) },
                    anual: roundAll(yearlyReturns(result.values)),
                    curva: sampleCurve(result.values),
                    carteiraInicial: result.initial,
                    carteiraAtual: result.holdings,
                    trocas: result.trades,
                    eventos: result.events,
                };
                logger.info(`${year} ${strategy} ${mode}: ${round(m.retorno)}% (CDI ${round(m.cdi)}%)`);
            }
        }
        starts.push({
            ano: year,
            inicio: start,
            fim: today,
            rebalanceamentos: rebalanceOn,
            benchmarks: {
                cdi: { metricas: roundAll(summarizeSeries(cdiValues, cdiValues)), anual: roundAll(yearlyReturns(cdiValues)), curva: sampleCurve(cdiValues) },
                ibov: { metricas: roundAll(summarizeSeries(ibovValues, cdiValues)), anual: roundAll(yearlyReturns(ibovValues)), curva: sampleCurve(ibovValues) },
            },
            estrategias: runs,
        });
    }

    writeAtomically(OUTPUT, JSON.stringify({
        updatedAt: new Date().toISOString(),
        sources: ['CVM dados abertos (DFP/ITR/FCA/cadastro)', 'Yahoo Finance', 'Banco Central (SGS 12, CDI)'],
        parametros: { ...PARAMS, ancorasRebalanceamento: ['05/04', '20/05', '20/08', '20/11'] },
        inicios: starts,
    }));
    logger.info(`wrote ${OUTPUT}`);
}

main().catch(e => {
    logger.error(e);
    process.exit(1);
});
