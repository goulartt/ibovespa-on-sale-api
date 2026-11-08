// CDI daily rates from Banco Central's SGS open data (series 12, % per business day).
const axios = require('axios');

const SGS_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados';
const MAX_WINDOW_YEARS = 5; // SGS limits each request to 10 years

const toBr = iso => iso.split('-').reverse().join('/');
const fromBr = br => br.split('/').reverse().join('-');

// Pure: SGS rows [{ data: 'dd/MM/yyyy', valor: '0.050788' }] -> Map isoDate -> % per day.
function parseCdi(rows) {
    const rates = new Map();
    for (const r of rows || []) {
        const v = Number(r.valor);
        if (r.data && Number.isFinite(v)) rates.set(fromBr(r.data), v);
    }
    return rates;
}

async function fetchCdi({ from, to, http = axios }) {
    const rates = new Map();
    const endYear = Number(to.slice(0, 4));
    for (let y = Number(from.slice(0, 4)); y <= endYear; y += MAX_WINDOW_YEARS) {
        const start = y === Number(from.slice(0, 4)) ? from : `${y}-01-01`;
        const lastYear = Math.min(y + MAX_WINDOW_YEARS - 1, endYear);
        const end = lastYear === endYear ? to : `${lastYear}-12-31`;
        const { data } = await http.get(SGS_URL, {
            params: { formato: 'json', dataInicial: toBr(start), dataFinal: toBr(end) },
            timeout: 30 * 1000,
        });
        for (const [k, v] of parseCdi(data)) rates.set(k, v);
    }
    if (rates.size === 0) throw new Error('no CDI rates returned by the Banco Central');
    return rates;
}

module.exports = { fetchCdi, parseCdi };
