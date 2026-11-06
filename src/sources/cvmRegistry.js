// Company registry from CVM (https://dados.cvm.gov.br/dataset/cia_aberta-cad):
// - SIT_EMISSOR tells whether a company operates normally or is under judicial/extrajudicial
//   recovery, bankruptcy or liquidation (replaces the old hand-maintained ticker list);
// - SETOR_ATIV is the company's activity sector, grouped into main sectors for the UI.
const axios = require('axios');
const { sectorGroup } = require('../domain/sectors');

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

// Banks and insurers: EBIT and EV don't apply to them (financial results are their operation).
// Some insurers (e.g. Porto Seguro, Caixa Seguridade) file statements in the industrial format,
// so they are identified by their CVM sector. Insurance brokers ("corretora"/"corretagem") are
// regular service companies and stay.
const FINANCIAL_SECTOR = /banco|intermedia[çc][ãa]o financeira|arrendamento|securitiza|factoring|cr[ée]dito/i;
const INSURANCE_SECTOR = /segurador/i;
const BROKER_NAME = /corret/i;

function isFinancialInstitution(rawSector, name) {
    const sector = String(rawSector || '');
    if (FINANCIAL_SECTOR.test(sector)) return true;
    return INSURANCE_SECTOR.test(sector) && !BROKER_NAME.test(String(name || ''));
}

function parseCsv(text) {
    const lines = text.split(/\r?\n/);
    const header = lines[0].split(';');
    return lines.slice(1).filter(Boolean).map(line => {
        const cols = line.split(';');
        return Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    });
}

// Returns Map cnpj -> { situacao, desde, setor } for active companies.
// `situacao` is null for companies operating normally.
function parseRegistry(text) {
    const result = new Map();
    for (const row of parseCsv(text)) {
        if (row.SIT !== 'ATIVO') continue;
        const situacao = DISTRESSED_STATUSES[(row.SIT_EMISSOR || '').trim()] || null;
        result.set(row.CNPJ_CIA, {
            situacao,
            desde: situacao ? row.DT_INI_SIT_EMISSOR || null : null,
            setor: sectorGroup(row.SETOR_ATIV),
            financeira: isFinancialInstitution(row.SETOR_ATIV, row.DENOM_SOCIAL),
        });
    }
    return result;
}

async function loadRegistry({ http = axios } = {}) {
    const { data } = await http.get(REGISTRY_URL, { responseType: 'arraybuffer', timeout: 2 * 60 * 1000 });
    const registry = parseRegistry(Buffer.from(data).toString('latin1'));
    const distressed = [...registry.values()].filter(c => c.situacao).length;
    if (registry.size < 100 || distressed === 0) {
        throw new Error(`CVM registry looks wrong (${registry.size} companies, ${distressed} distressed); the file format may have changed`);
    }
    return registry;
}

module.exports = { loadRegistry, parseRegistry, isFinancialInstitution, DISTRESSED_STATUSES };
