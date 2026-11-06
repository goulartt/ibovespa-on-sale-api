// Fundamentals from CVM open data (https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp, -itr, -fca).
// DFP = annual statements, ITR = quarterly statements, FCA = registry (CNPJ -> B3 tickers).
const axios = require('axios');
const AdmZip = require('adm-zip');
const { logger: defaultLogger } = require('../lib/logger');

const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';

const PROFIT_HISTORY_YEARS = 5;
const DEPRECIATION_ACCOUNT = '7.04.01';
const DRE_ACCOUNT = /^3\.\d\d(\.\d\d)?$/; // first two levels of the income statement
const BPA_ACCOUNTS = new Set(['1.01.01', '1.01.02']);
const BPP_ACCOUNT = c => c === '2.01.04' || c === '2.02.01' || /^2\.\d\d$/.test(c); // + level 2 (equity)

// Downloads one yearly CVM zip. Returns null when that year is not published yet (404).
async function downloadZip(doc, year, { http = axios, logger = defaultLogger } = {}) {
    const url = `${BASE}/${doc}/DADOS/${doc.toLowerCase()}_cia_aberta_${year}.zip`;
    try {
        const { data } = await http.get(url, { responseType: 'arraybuffer', timeout: 5 * 60 * 1000 });
        logger.info(`downloaded ${url}`);
        return new AdmZip(Buffer.from(data));
    } catch (e) {
        if (e.response && e.response.status === 404) {
            logger.info(`not published yet: ${url}`);
            return null;
        }
        throw e;
    }
}

function readCsv(zip, name, keep) {
    const entry = zip.getEntry(name);
    if (!entry) return [];
    const lines = entry.getData().toString('latin1').split(/\r?\n/);
    const header = lines[0].split(';');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cols = lines[i].split(';');
        if (cols.length !== header.length) continue;
        const row = {};
        for (let j = 0; j < header.length; j++) row[header[j]] = cols[j];
        if (!keep || keep(row)) rows.push(row);
    }
    return rows;
}

// Keeps only the latest version (VERSAO) of each filing (CNPJ + DT_REFER).
function latestVersionOnly(rows) {
    const max = new Map();
    for (const r of rows) {
        const k = `${r.CNPJ_CIA}|${r.DT_REFER}`;
        max.set(k, Math.max(max.get(k) || 0, Number(r.VERSAO)));
    }
    return rows.filter(r => Number(r.VERSAO) === max.get(`${r.CNPJ_CIA}|${r.DT_REFER}`));
}

const scale = r => (r.ESCALA_MOEDA === 'MIL' ? 1000 : 1);

// companies: cnpj -> { filings: dtRefer -> { type, con: Map, ind: Map, labels, equityAccount, shares } }
function ingest(companies, zip, type, year) {
    const prefix = `${type.toLowerCase()}_cia_aberta`;
    const filing = (cnpj, dtRefer) => {
        if (!companies.has(cnpj)) companies.set(cnpj, { filings: new Map() });
        const filings = companies.get(cnpj).filings;
        if (!filings.has(dtRefer)) filings.set(dtRefer, { type, con: new Map(), ind: new Map() });
        return filings.get(dtRefer);
    };

    for (const src of ['con', 'ind']) {
        const dre = latestVersionOnly(readCsv(zip, `${prefix}_DRE_${src}_${year}.csv`, r => DRE_ACCOUNT.test(r.CD_CONTA)));
        for (const r of dre) {
            const f = filing(r.CNPJ_CIA, r.DT_REFER);
            f[src].set(`DRE|${r.ORDEM_EXERC}|${r.DT_INI_EXERC}|${r.CD_CONTA}`, Number(r.VL_CONTA) * scale(r));
            if (r.ORDEM_EXERC === 'ÚLTIMO') {
                f.labels = f.labels || { con: new Map(), ind: new Map() };
                f.labels[src].set(r.CD_CONTA, r.DS_CONTA);
            }
        }
        // Depreciation & amortization (for EBITDA) from the value-added statement (DVA). It is a
        // year-to-date flow like the income statement, so it is stored with the same keys.
        const dva = latestVersionOnly(readCsv(zip, `${prefix}_DVA_${src}_${year}.csv`,
            r => r.CD_CONTA === DEPRECIATION_ACCOUNT && /deprecia/i.test(r.DS_CONTA)));
        for (const r of dva) {
            filing(r.CNPJ_CIA, r.DT_REFER)[src].set(`DRE|${r.ORDEM_EXERC}|${r.DT_INI_EXERC}|${r.CD_CONTA}`, Number(r.VL_CONTA) * scale(r));
        }

        for (const [file, keep] of [['BPA', c => BPA_ACCOUNTS.has(c)], ['BPP', BPP_ACCOUNT]]) {
            const bp = latestVersionOnly(readCsv(zip, `${prefix}_${file}_${src}_${year}.csv`,
                r => keep(r.CD_CONTA) && r.ORDEM_EXERC === 'ÚLTIMO'));
            for (const r of bp) {
                const f = filing(r.CNPJ_CIA, r.DT_REFER);
                f[src].set(`BP|${r.CD_CONTA}`, Number(r.VL_CONTA) * scale(r));
                if (/^Patrim[ôo]nio L[íi]quido/i.test(r.DS_CONTA) && r.CD_CONTA.split('.').length === 2) {
                    f.equityAccount = f.equityAccount || {};
                    f.equityAccount[src] = r.CD_CONTA;
                }
                if (/^Passivo N[ãa]o Circulante/i.test(r.DS_CONTA) && r.CD_CONTA.split('.').length === 2) {
                    f.nonCurrentLiabilitiesAccount = f.nonCurrentLiabilitiesAccount || {};
                    f.nonCurrentLiabilitiesAccount[src] = r.CD_CONTA;
                }
            }
        }
    }

    const capital = latestVersionOnly(readCsv(zip, `${prefix}_composicao_capital_${year}.csv`));
    for (const r of capital) {
        const on = Number(r.QT_ACAO_ORDIN_CAP_INTEGR) - Number(r.QT_ACAO_ORDIN_TESOURO || 0);
        const pn = Number(r.QT_ACAO_PREF_CAP_INTEGR) - Number(r.QT_ACAO_PREF_TESOURO || 0);
        if (on + pn > 0) filing(r.CNPJ_CIA, r.DT_REFER).shares = { on, pn };
    }
}

// Year-to-date value of an account: the period of the given order (ÚLTIMO/PENÚLTIMO)
// with the earliest start date (the quarter-only rows start later).
function ytd(values, ordem, conta) {
    let best = null;
    for (const [k, v] of values) {
        const [kind, o, dtIni, c] = k.split('|');
        if (kind === 'DRE' && o === ordem && c === conta && (!best || dtIni < best.dtIni)) best = { dtIni, v };
    }
    return best;
}

const dayBefore = iso => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

// Trailing twelve months: last annual (DFP) + current YTD - previous year's YTD.
// `account` is an account code, or a function (filing, src) -> code, because the same line can
// have different codes in different filings.
function ttm(company, latest, src, account) {
    const codeFor = typeof account === 'function' ? account : () => account;
    const conta = codeFor(latest, src);
    if (!conta) return null;
    const values = latest[src];
    const cur = ytd(values, 'ÚLTIMO', conta);
    if (!cur) return null;
    if (latest.type === 'DFP') return cur.v;
    const prev = ytd(values, 'PENÚLTIMO', conta);
    const annual = company.filings.get(dayBefore(cur.dtIni));
    const annualConta = annual && annual.type === 'DFP' && codeFor(annual, src);
    const annualValue = annualConta && ytd(annual[src], 'ÚLTIMO', annualConta);
    if (!prev || !annualValue) return null;
    return annualValue.v + cur.v - prev.v;
}

// Net income attributable to the controlling shareholders (or total net income), found by name.
function netIncomeAccount(filing, src) {
    const labels = (filing.labels && filing.labels[src]) || new Map();
    const find = (re, parent) => [...labels.entries()]
        .find(([code, label]) => re.test(label) && (parent ? code.startsWith(`${parent}.`) : code.split('.').length === 2));
    const total = find(/^Lucro( ou |\s*\/\s*)Preju[ií]zo (L[ií]quido )?(Consolidado )?do Per[ií]odo/i);
    const controladora = total && find(/Controladora/i, total[0]);
    // Some companies without minority interests fill the "Controladora" line with zeros.
    const hasValue = code => [...filing[src]].some(([k, v]) => k.endsWith(`|${code}`) && k.startsWith('DRE|ÚLTIMO') && v !== 0);
    return (controladora && hasValue(controladora[0]) ? controladora : total || [])[0];
}

// Net income of each fiscal year (from the annual DFP statements), oldest first, last 5 years.
function annualNetIncome(company) {
    const result = [];
    for (const [date, filing] of [...company.filings].sort(([a], [b]) => a.localeCompare(b))) {
        if (filing.type !== 'DFP') continue;
        const src = filing.con.size > 0 ? 'con' : 'ind';
        const conta = netIncomeAccount(filing, src);
        const value = conta && ytd(filing[src], 'ÚLTIMO', conta);
        if (value) result.push({ ano: Number(date.slice(0, 4)), lucro: value.v });
    }
    return result.slice(-PROFIT_HISTORY_YEARS);
}

// Capital employed (equity + non-current liabilities) of one filing, or null when unavailable.
function capitalEmployed(filing, src) {
    const equity = filing.equityAccount?.[src];
    const nonCurrent = filing.nonCurrentLiabilitiesAccount?.[src];
    if (!equity || !nonCurrent) return null;
    const value = (filing[src].get(`BP|${equity}`) ?? 0) + (filing[src].get(`BP|${nonCurrent}`) ?? 0);
    return value > 0 ? value : null;
}

// Average of the latest capital employed and the one at the previous fiscal year end.
function averageCapitalEmployed(company, dates, latestDate, src) {
    const latest = capitalEmployed(company.filings.get(latestDate), src);
    if (latest == null) return null;
    const previousAnnual = [...dates].reverse()
        .map(d => [d, company.filings.get(d)])
        .find(([d, f]) => d < latestDate && f.type === 'DFP');
    const previous = previousAnnual && capitalEmployed(previousAnnual[1], src);
    return previous == null ? latest : (latest + previous) / 2;
}

function buildCompany(cnpj, company) {
    const dates = [...company.filings.keys()].sort();
    const latestDate = dates[dates.length - 1];
    const latest = company.filings.get(latestDate);
    const src = latest.con.size > 0 ? 'con' : 'ind';
    const values = latest[src];
    if (values.size === 0) return null;

    const sharesFiling = [...dates].reverse().map(d => company.filings.get(d)).find(f => f.shares);
    if (!sharesFiling) return null;

    const labels = (latest.labels && latest.labels[src]) || new Map();
    const lucro = ttm(company, latest, src, netIncomeAccount);
    // Banks and insurers don't have an EBIT line (3.05 has a different meaning in their DRE).
    const financeira = !/^Resultado Antes do Resultado Financeiro/i.test(labels.get('3.05') || '');
    const get = conta => values.get(`BP|${conta}`) ?? 0;
    const ebit = financeira ? null : ttm(company, latest, src, '3.05');
    const depreciation = financeira ? null : ttm(company, latest, src, DEPRECIATION_ACCOUNT);

    return {
        cnpj,
        dataBalanco: latestDate,
        lucrosAnuais: annualNetIncome(company),
        financeira,
        acoes: sharesFiling.shares,
        receita: ttm(company, latest, src, '3.01'),
        ebit,
        // DVA reports depreciation as a negative "retention"
        ebitda: ebit != null && depreciation != null ? ebit + Math.abs(depreciation) : null,
        capitalEmpregado: financeira ? null : averageCapitalEmployed(company, dates, latestDate, src),
        lucro,
        patrimonio: latest.equityAccount && latest.equityAccount[src] ? get(latest.equityAccount[src]) : null,
        dividaLiquida: financeira ? null : get('2.01.04') + get('2.02.01') - get('1.01.01') - get('1.01.02'),
    };
}

// cnpj -> { empresa, tickers: [{ ticker, classe: 'ON' | 'PN' | 'UNIT' }] }
function readTickers(fcaZips) {
    const byCnpj = new Map();
    for (const { zip, year } of fcaZips) { // newest year first; keep the newest registry per company
        const rows = latestVersionOnly(readCsv(zip, `fca_cia_aberta_valor_mobiliario_${year}.csv`)
            .map(r => ({ ...r, CNPJ_CIA: r.CNPJ_Companhia, DT_REFER: r.Data_Referencia, VERSAO: r.Versao })));
        const seenThisYear = new Set();
        for (const r of rows) {
            if (r.Mercado !== 'Bolsa' || r.Data_Fim_Negociacao || !r.Codigo_Negociacao) continue;
            const classe = { 'Ações Ordinárias': 'ON', 'Ações Preferenciais': 'PN', 'Units': 'UNIT' }[r.Valor_Mobiliario];
            if (!classe) continue;
            if (byCnpj.has(r.CNPJ_CIA) && !seenThisYear.has(r.CNPJ_CIA)) continue;
            seenThisYear.add(r.CNPJ_CIA);
            if (!byCnpj.has(r.CNPJ_CIA)) byCnpj.set(r.CNPJ_CIA, { empresa: r.Nome_Empresarial, tickers: [] });
            const entry = byCnpj.get(r.CNPJ_CIA);
            const ticker = r.Codigo_Negociacao.trim().toUpperCase();
            if (!entry.tickers.some(t => t.ticker === ticker)) entry.tickers.push({ ticker, classe });
        }
    }
    return byCnpj;
}

async function loadFundamentals({ now = new Date(), download = downloadZip } = {}) {
    const year = now.getUTCFullYear();
    const companies = new Map();
    const dfpYears = Array.from({ length: PROFIT_HISTORY_YEARS + 1 }, (_, i) => year - PROFIT_HISTORY_YEARS + i);
    for (const [type, y] of [...dfpYears.map(y => ['DFP', y]), ['ITR', year - 1], ['ITR', year]]) {
        const zip = await download(type, y);
        if (zip) ingest(companies, zip, type, y);
    }
    if (companies.size === 0) throw new Error('no CVM statements could be loaded');

    const fcaZips = [];
    for (const y of [year, year - 1]) {
        const zip = await download('FCA', y);
        if (zip) fcaZips.push({ zip, year: y });
    }
    const tickers = readTickers(fcaZips);

    // Ignore companies whose last statement is older than ~18 months (deregistered / delinquent).
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
    const minDate = cutoff.toISOString().slice(0, 10);

    const result = [];
    for (const [cnpj, company] of companies) {
        const listed = tickers.get(cnpj);
        if (!listed || listed.tickers.length === 0) continue;
        const fundamentals = buildCompany(cnpj, company);
        if (!fundamentals || fundamentals.dataBalanco < minDate) continue;
        result.push({ ...fundamentals, empresa: listed.empresa, tickers: listed.tickers });
    }
    return result;
}

module.exports = {
    loadFundamentals,
    downloadZip,
    // exported for tests
    readCsv,
    latestVersionOnly,
    ingest,
    buildCompany,
    readTickers,
};
