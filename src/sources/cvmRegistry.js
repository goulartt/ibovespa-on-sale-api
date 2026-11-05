// Issuer status from the CVM company registry (https://dados.cvm.gov.br/dataset/cia_aberta-cad).
// SIT_EMISSOR tells whether a company is operating normally or under judicial/extrajudicial
// recovery, bankruptcy or liquidation. It replaces the old hand-maintained list of tickers.
const axios = require('axios');

const REGISTRY_URL = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv';

// Raw CVM value -> label shown to users. Statuses not listed here (e.g. "FASE OPERACIONAL",
// "FASE PRÉ-OPERACIONAL") are considered normal.
const DISTRESSED_STATUSES = {
    'EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE': 'Em recuperação judicial',
    'EM RECUPERAÇÃO EXTRAJUDICIAL': 'Em recuperação extrajudicial',
    'FALIDA': 'Falida',
    'EM LIQUIDAÇÃO JUDICIAL': 'Em liquidação',
    'LIQUIDAÇÃO EXTRAJUDICIAL': 'Em liquidação',
    'PARALISADA': 'Paralisada',
};

function parseCsv(text) {
    const lines = text.split(/\r?\n/);
    const header = lines[0].split(';');
    return lines.slice(1).filter(Boolean).map(line => {
        const cols = line.split(';');
        return Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    });
}

// Returns Map cnpj -> { situacao, desde } for active companies in a distressed situation.
function parseIssuerStatus(text) {
    const result = new Map();
    for (const row of parseCsv(text)) {
        if (row.SIT !== 'ATIVO') continue;
        const situacao = DISTRESSED_STATUSES[(row.SIT_EMISSOR || '').trim()];
        if (situacao) result.set(row.CNPJ_CIA, { situacao, desde: row.DT_INI_SIT_EMISSOR || null });
    }
    return result;
}

async function loadIssuerStatus({ http = axios } = {}) {
    const { data } = await http.get(REGISTRY_URL, { responseType: 'arraybuffer', timeout: 2 * 60 * 1000 });
    const statuses = parseIssuerStatus(Buffer.from(data).toString('latin1'));
    if (statuses.size === 0) throw new Error('CVM registry has no distressed companies; the file format may have changed');
    return statuses;
}

module.exports = { loadIssuerStatus, parseIssuerStatus, DISTRESSED_STATUSES };
