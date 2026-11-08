// Backtest of the strategies since 2014 against the CDI and the Ibovespa: top 20, buy-and-hold and
// quarterly rotation, current rules vs. the rules before the 2014-2026 review. Writes
// data/backtest.json. Run: npm run backtest (monthly via .github/workflows/backtest.yml)
const path = require('path');
const { loadHistory } = require('../src/sources/cvm');
const { loadRegistry } = require('../src/sources/cvmRegistry');
const { fetchHistory, adjCloseOn } = require('../src/sources/yahoo');
const { fetchCdi } = require('../src/sources/benchmarks');
const { createRanker } = require('../src/backtest/pointInTime');
const {
    simulate, rebalanceDates, cdiIndex, summarizeSeries, yearlyReturns, sampleCurve, MODES,
} = require('../src/backtest/engine');
const { rankStocks, PREVIOUS_RULES } = require('../src/domain/ranking');
const { mapWithConcurrency } = require('../src/lib/concurrency');
const { logger } = require('../src/lib/logger');
const { writeAtomically } = require('../src/lib/files');

const OUTPUT = path.join(__dirname, '..', 'data', 'backtest.json');
const FROM_YEAR = 2014; // CVM open data starts in 2010; the rules need 3 annual statements
const PRICES_FROM = `${FROM_YEAR - 6}-01-01`;
// Intrinsic value needs the interest rates of each date, not available historically here.
const STRATEGY_NAMES = ['deepValue', 'dividendos', 'qualidade'];
const VERSIONS = { novas: {}, anteriores: PREVIOUS_RULES };
const PARAMS = { size: 20, buffer: 40, cost: 0.001, maxStaleDays: 10 };
const MAX_HISTORY_FAILURE_RATIO = 0.5; // many tickers of delisted companies have no history

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
    const { companies, tickers, capital } = await loadHistory({ fromYear: FROM_YEAR });
    const allTickers = [...new Set([...tickers.values()].flatMap(t => t.tickers.map(x => x.ticker)))];
    logger.info(`${companies.size} companies with CVM statements, ${allTickers.length} tickers`);

    const histories = await fetchHistories(allTickers);
    const ibov = await fetchHistory('IBOV', { from: PRICES_FROM, symbol: '^BVSP' });
    if (!ibov) throw new Error('no Ibovespa history');
    const calendar = ibov.days.map(d => d.date);
    const today = calendar[calendar.length - 1];
    const cdi = cdiIndex(calendar, await fetchCdi({ from: `${FROM_YEAR - 1}-12-01`, to: today }));
    const ibovOn = new Map(ibov.days.map(d => [d.date, d.adj]));

    const ranker = createRanker({ companies, tickers, registry, histories, capital });
    const priceOn = (ticker, day) => adjCloseOn(histories[ticker], day);
    const rankings = new Map();
    const rankAt = (asOf, strategy, version) => {
        const key = `${asOf}|${strategy}|${version}`;
        if (!rankings.has(key)) {
            rankings.set(key, rankStocks(ranker.stocksAt(asOf), { strategy, limit: Infinity, ...VERSIONS[version][strategy] }));
        }
        return rankings.get(key);
    };
    const firstDay = from => calendar.find(d => d >= from);
    const lastDay = to => [...calendar].reverse().find(d => d <= to);
    const run = (strategy, version, mode, start, end) => simulate({
        calendar, start, end, cdi, priceOn, mode, rebalanceOn: rebalanceDates(calendar, start, end), ...PARAMS,
        rankAt: asOf => rankAt(asOf, strategy, version),
    });

    const periods = [
        { id: 'completo', label: `${FROM_YEAR} até hoje`, from: `${FROM_YEAR}-01-01`, to: today },
        { id: 'escolha', label: '2014 a 2019 (escolha das regras)', from: '2014-01-01', to: '2019-12-31' },
        { id: 'validacao', label: '2020 até hoje (validação)', from: '2020-01-01', to: today },
    ];

    const periodos = periods.map(p => {
        const start = firstDay(p.from);
        const end = lastDay(p.to);
        const days = calendar.filter(d => d >= start && d <= end);
        const cdiValues = days.map(d => [d, cdi.get(d)]);
        const ibovValues = days.map(d => [d, ibovOn.get(d)]);
        const estrategias = {};
        for (const strategy of STRATEGY_NAMES) {
            estrategias[strategy] = {};
            for (const version of Object.keys(VERSIONS)) {
                estrategias[strategy][version] = {};
                for (const mode of MODES) {
                    const result = run(strategy, version, mode, start, end);
                    const m = summarizeSeries(result.values, cdiValues);
                    estrategias[strategy][version][mode] = {
                        metricas: { ...roundAll(m), operacoes: result.trades.reduce((n, t) => n + t.sold.length + t.bought.length, 0) },
                        anual: roundAll(yearlyReturns(result.values)),
                        curva: sampleCurve(result.values),
                        carteiraInicial: result.initial,
                        carteiraAtual: result.holdings,
                        trocas: result.trades,
                        eventos: result.events,
                    };
                    logger.info(`${p.id} ${strategy} ${version} ${mode}: ${round(m.retornoAnual)}% a.a. (CDI ${round(m.cdi)}% no período)`);
                }
            }
        }
        const bench = values => ({
            metricas: roundAll(summarizeSeries(values, cdiValues)), anual: roundAll(yearlyReturns(values)), curva: sampleCurve(values),
        });
        return { id: p.id, label: p.label, inicio: start, fim: end, benchmarks: { cdi: bench(cdiValues), ibov: bench(ibovValues) }, estrategias };
    });

    // Robustness: one portfolio started each January, held (with the same rules) until today.
    const startYears = [];
    for (let y = FROM_YEAR; y < Number(today.slice(0, 4)); y++) startYears.push(y);
    const robustez = { anos: startYears };
    for (const strategy of STRATEGY_NAMES) {
        robustez[strategy] = {};
        for (const version of Object.keys(VERSIONS)) {
            robustez[strategy][version] = {};
            for (const mode of MODES) {
                const beat = startYears.filter(y => {
                    const start = firstDay(`${y}-01-01`);
                    const values = run(strategy, version, mode, start, today).values;
                    const v = values[values.length - 1][1] / values[0][1];
                    return v > cdi.get(today) / cdi.get(start);
                }).length;
                robustez[strategy][version][mode] = { acimaCdi: beat, total: startYears.length };
            }
        }
    }

    writeAtomically(OUTPUT, JSON.stringify({
        updatedAt: new Date().toISOString(),
        sources: ['CVM dados abertos (DFP/ITR/FCA/FRE/cadastro)', 'Yahoo Finance', 'Banco Central (SGS 12, CDI)'],
        parametros: { ...PARAMS, ancorasRebalanceamento: ['05/04', '20/05', '20/08', '20/11'] },
        periodos,
        robustez,
    }));
    logger.info(`wrote ${OUTPUT}`);
}

main().catch(e => {
    logger.error(e);
    process.exit(1);
});
