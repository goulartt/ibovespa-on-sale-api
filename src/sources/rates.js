// Inputs for the intrinsic value discount rate, from public open data:
// - Tesouro Direto prices and rates (Tesouro Transparente CKAN): real yield of the
//   "Tesouro IPCA+ com Juros Semestrais" maturing closest to 10 years ahead;
// - Banco Central's Focus survey: median IPCA expected for the next 12 months.
const axios = require('axios');

const CKAN_PACKAGE = 'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=taxas-dos-titulos-ofertados-pelo-tesouro-direto';
const FOCUS_URL = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoInflacao12Meses';
const BOND = 'Tesouro IPCA+ com Juros Semestrais';
const TARGET_YEARS = 10;

const brDate = br => br.split('/').reverse().join('-');
const brNumber = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

// Pure: Tesouro Direto CSV text -> { titulo, vencimento, data, taxa } for the latest day.
function parseTesouro(text) {
    const rows = text.split(/\r?\n/).slice(1).map(l => l.split(';')).filter(c => c[0] === BOND && c.length >= 4);
    if (rows.length === 0) return null;
    const latest = rows.reduce((max, c) => (brDate(c[2]) > max ? brDate(c[2]) : max), '');
    const target = Date.parse(latest) + TARGET_YEARS * 365.25 * 86400000;
    const best = rows
        .filter(c => brDate(c[2]) === latest && Number.isFinite(brNumber(c[3])))
        .sort((a, b) => Math.abs(Date.parse(brDate(a[1])) - target) - Math.abs(Date.parse(brDate(b[1])) - target))[0];
    if (!best) return null;
    const vencimento = brDate(best[1]);
    return { titulo: `${BOND} ${vencimento.slice(0, 4)}`, vencimento, data: latest, taxa: brNumber(best[3]) };
}

async function fetchTesouro({ http = axios } = {}) {
    const { data: pkg } = await http.get(CKAN_PACKAGE, { timeout: 30 * 1000 });
    const resource = pkg?.result?.resources?.find(r => String(r.format).toUpperCase() === 'CSV');
    if (!resource) throw new Error('Tesouro Direto CSV not found in the CKAN package');
    const { data } = await http.get(resource.url, { responseType: 'arraybuffer', timeout: 3 * 60 * 1000 });
    const result = parseTesouro(Buffer.from(data).toString('latin1'));
    if (!result) throw new Error(`no "${BOND}" rates in the Tesouro Direto file`);
    return result;
}

// Pure: Focus OData response -> { data, ipca } (median, smoothed, next 12 months).
function parseFocus(body) {
    const row = body?.value?.[0];
    return row && Number.isFinite(row.Mediana) ? { data: row.Data, ipca: row.Mediana } : null;
}

async function fetchIpcaExpectation({ http = axios } = {}) {
    // OData rejects "+" for spaces (axios' default), so the query is encoded by hand.
    const query = Object.entries({
        $top: 1,
        $filter: "Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq 0",
        $orderby: 'Data desc',
        $format: 'json',
    }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const { data } = await http.get(`${FOCUS_URL}?${query}`, { timeout: 30 * 1000 });
    const result = parseFocus(data);
    if (!result) throw new Error('no IPCA expectation in the Focus response');
    return result;
}

module.exports = { fetchTesouro, fetchIpcaExpectation, parseTesouro, parseFocus };
