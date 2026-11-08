// Pure portfolio simulation: no network, everything is injected (testable with synthetic data).
//
// - Starts on `start` with `size` equally weighted positions from the ranking of the previous
//   trading day (only information available before the trade).
// - "buyAndHold" never trades again. "rotation" checks the ranking on each rebalance date: a
//   position ranked worse than `buffer` (or no longer ranked) is sold and replaced by the best
//   ranked company not held. Surviving positions are not rebalanced.
// - Cash earns the CDI. A position without quotes for `maxStaleDays` trading days (delisted) is
//   turned into cash at its last price.
// - Prices are total-return prices (dividends reinvested).

const MODES = ['buyAndHold', 'rotation'];
const REBALANCE_ANCHORS = ['04-05', '05-20', '08-20', '11-20']; // after the DFP / ITR deadlines

// First trading day on or after each anchor date, strictly after `start` and up to `end`.
function rebalanceDates(calendar, start, end, anchors = REBALANCE_ANCHORS) {
    const dates = new Set();
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
        for (const a of anchors) {
            const day = calendar.find(d => d >= `${y}-${a}`);
            if (day && day > start && day <= end) dates.add(day);
        }
    }
    return [...dates].sort();
}

// Cumulative CDI index per trading day (1 on the first day). The rate published for a day
// accrues until the next one; days without a rate reuse the last known one.
function cdiIndex(calendar, rates) {
    const index = new Map();
    let value = 1;
    let lastRate = 0;
    calendar.forEach((day, i) => {
        if (i > 0) {
            const rate = rates.get(calendar[i - 1]) ?? lastRate;
            lastRate = rate;
            value *= 1 + rate / 100;
        }
        index.set(day, value);
    });
    return index;
}

function simulate({
    calendar, start, end, rankAt, priceOn, cdi, mode = 'rotation',
    size = 10, buffer = 20, cost = 0.001, maxStaleDays = 10, rebalanceOn,
}) {
    if (!MODES.includes(mode)) throw new RangeError(`unknown mode "${mode}"`);
    const first = calendar.findIndex(d => d >= start);
    if (first < 1) throw new RangeError(`no trading day before ${start}`);
    const days = calendar.slice(first).filter(d => d <= end);
    const rebalance = new Set(mode === 'rotation' ? (rebalanceOn || rebalanceDates(calendar, days[0], end)) : []);

    let cash = 1;
    let positions = [];
    const values = [];
    const trades = [];
    const events = [];
    let initial = [];

    const fill = (ranking, day, bought) => {
        const held = new Set(positions.map(p => p.empresa));
        let slots = size - positions.length;
        for (const stock of ranking) {
            if (slots <= 0) break;
            if (held.has(stock.Empresa)) continue;
            const price = priceOn(stock.Ativo, day);
            if (!price) continue;
            const amount = cash / slots;
            cash -= amount;
            positions.push({ ticker: stock.Ativo, empresa: stock.Empresa, units: (amount * (1 - cost)) / price, last: price, stale: 0 });
            held.add(stock.Empresa);
            slots--;
            bought.push({ ticker: stock.Ativo, empresa: stock.Empresa, rank: stock.Ranking });
        }
    };

    days.forEach((day, i) => {
        const previous = calendar[first + i - 1];
        if (i > 0) cash *= cdi.get(day) / cdi.get(previous);

        positions = positions.filter(p => {
            const price = priceOn(p.ticker, day);
            if (price) {
                p.last = price;
                p.stale = 0;
                return true;
            }
            if (++p.stale <= maxStaleDays) return true;
            cash += p.units * p.last;
            events.push({ date: day, ticker: p.ticker, event: 'sem cotação' });
            return false;
        });

        if (i === 0) {
            const bought = [];
            fill(rankAt(previous), day, bought);
            initial = bought;
        } else if (rebalance.has(day)) {
            const ranking = rankAt(previous);
            const rankOf = new Map(ranking.map(s => [s.Empresa, s.Ranking]));
            const sold = [];
            positions = positions.filter(p => {
                const rank = rankOf.get(p.empresa) ?? null;
                if (rank != null && rank <= buffer) return true;
                cash += p.units * p.last * (1 - cost);
                sold.push({ ticker: p.ticker, empresa: p.empresa, rank });
                return false;
            });
            const bought = [];
            fill(ranking, day, bought);
            if (sold.length || bought.length) trades.push({ date: day, sold, bought });
        }

        values.push([day, cash + positions.reduce((sum, p) => sum + p.units * p.last, 0)]);
    });

    return { values, initial, trades, events, holdings: positions.map(p => p.ticker) };
}

// ---- Metrics ----

const pct = (a, b) => (a / b - 1) * 100;

function maxDrawdown(values) {
    let peak = -Infinity;
    let worst = 0;
    for (const [, v] of values) {
        peak = Math.max(peak, v);
        worst = Math.min(worst, v / peak - 1);
    }
    return worst * 100;
}

function volatility(values) {
    const r = values.slice(1).map(([, v], i) => Math.log(v / values[i][1]));
    if (r.length < 2) return null;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    return Math.sqrt(variance * 252) * 100;
}

// `values` and `benchmark` are [[isoDate, value]] over the same days.
function summarizeSeries(values, cdiValues) {
    const [startDay, v0] = values[0];
    const [endDay, v1] = values[values.length - 1];
    const years = (Date.parse(endDay) - Date.parse(startDay)) / (365.25 * 86400000);
    const total = pct(v1, v0);
    const cdi = pct(cdiValues[cdiValues.length - 1][1], cdiValues[0][1]);
    return {
        retorno: total,
        retornoAnual: years > 0 ? (Math.pow(v1 / v0, 1 / years) - 1) * 100 : null,
        cdi,
        percentualCdi: cdi !== 0 ? (total / cdi) * 100 : null,
        excessoCdi: total - cdi,
        maxDrawdown: maxDrawdown(values),
        volatilidade: volatility(values),
    };
}

// Return of each calendar year (partial at the edges): last value of the year vs. the previous one.
function yearlyReturns(series) {
    const result = {};
    let base = series[0][1];
    series.forEach(([day, v], i) => {
        const next = series[i + 1];
        if (!next || next[0].slice(0, 4) !== day.slice(0, 4)) {
            result[day.slice(0, 4)] = pct(v, base);
            base = v;
        }
    });
    return result;
}

// Weekly samples (every 5th trading day + the last), normalized to 1 on the first day.
function sampleCurve(values, every = 5) {
    const v0 = values[0][1];
    return values
        .filter((_, i) => i % every === 0 || i === values.length - 1)
        .map(([day, v]) => [day, Math.round((v / v0) * 10000) / 10000]);
}

module.exports = {
    simulate, rebalanceDates, cdiIndex, summarizeSeries, yearlyReturns, sampleCurve, maxDrawdown, volatility,
    MODES, REBALANCE_ANCHORS,
};
