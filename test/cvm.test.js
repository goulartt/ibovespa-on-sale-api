const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readCsv, latestVersionOnly, ingest, buildCompany, readTickers, loadFundamentals } = require('../src/sources/cvm');
const { cvmZip } = require('./helpers');

const CNPJ = '11.111.111/0001-11';
const DRE_HEADER = ['CNPJ_CIA', 'DT_REFER', 'VERSAO', 'DENOM_CIA', 'ESCALA_MOEDA', 'ORDEM_EXERC', 'DT_INI_EXERC', 'DT_FIM_EXERC', 'CD_CONTA', 'DS_CONTA', 'VL_CONTA'];
const BP_HEADER = ['CNPJ_CIA', 'DT_REFER', 'VERSAO', 'DENOM_CIA', 'ESCALA_MOEDA', 'ORDEM_EXERC', 'DT_FIM_EXERC', 'CD_CONTA', 'DS_CONTA', 'VL_CONTA'];
const CAP_HEADER = ['CNPJ_CIA', 'DT_REFER', 'VERSAO', 'QT_ACAO_ORDIN_CAP_INTEGR', 'QT_ACAO_PREF_CAP_INTEGR', 'QT_ACAO_ORDIN_TESOURO', 'QT_ACAO_PREF_TESOURO'];

const EBIT_LABEL = 'Resultado Antes do Resultado Financeiro e dos Tributos';
const NET_LABEL = 'Lucro/Prejuízo Consolidado do Período';

// One DRE period: revenue, EBIT, net income (+ optional controlling-interest line).
const dre = (dtRefer, ordem, dtIni, dtFim, { receita, ebit, lucro, controladora }, versao = 1) => [
    [CNPJ, dtRefer, versao, 'EMPRESA', 'MIL', ordem, dtIni, dtFim, '3.01', 'Receita de Venda de Bens e/ou Serviços', receita],
    [CNPJ, dtRefer, versao, 'EMPRESA', 'MIL', ordem, dtIni, dtFim, '3.05', EBIT_LABEL, ebit],
    [CNPJ, dtRefer, versao, 'EMPRESA', 'MIL', ordem, dtIni, dtFim, '3.11', NET_LABEL, lucro],
    ...(controladora == null ? [] : [[CNPJ, dtRefer, versao, 'EMPRESA', 'MIL', ordem, dtIni, dtFim, '3.11.01', 'Atribuído a Sócios da Empresa Controladora', controladora]]),
];

function dfp2025() {
    return cvmZip({
        'dfp_cia_aberta_DVA_con_2025.csv': [DVA_HEADER, dva('2025-12-31', 'ÚLTIMO', '2025-01-01', '2025-12-31', -50)],
        'dfp_cia_aberta_BPP_con_2025.csv': [BP_HEADER,
            [CNPJ, '2025-12-31', 1, 'EMPRESA', 'MIL', 'ÚLTIMO', '2025-12-31', '2.02', 'Passivo Não Circulante', 300],
            [CNPJ, '2025-12-31', 1, 'EMPRESA', 'MIL', 'ÚLTIMO', '2025-12-31', '2.03', 'Patrimônio Líquido Consolidado', 500]],
        'dfp_cia_aberta_DRE_con_2025.csv': [DRE_HEADER,
            ...dre('2025-12-31', 'ÚLTIMO', '2025-01-01', '2025-12-31', { receita: 1000, ebit: 200, lucro: 100, controladora: 90 })],
        'dfp_cia_aberta_composicao_capital_2025.csv': [CAP_HEADER, [CNPJ, '2025-12-31', 1, 1000, 500, 10, 0]],
    });
}

const DVA_HEADER = DRE_HEADER;
const dva = (dtRefer, ordem, dtIni, dtFim, value) =>
    [CNPJ, dtRefer, 1, 'EMPRESA', 'MIL', ordem, dtIni, dtFim, '7.04.01', 'Depreciação, Amortização e Exaustão', value];

function itr2026({ versao = 1 } = {}) {
    return cvmZip({
        'itr_cia_aberta_DVA_con_2026.csv': [DVA_HEADER,
            dva('2026-09-30', 'ÚLTIMO', '2026-01-01', '2026-09-30', -40),
            dva('2026-09-30', 'PENÚLTIMO', '2025-01-01', '2025-09-30', -30)],
        'itr_cia_aberta_DRE_con_2026.csv': [DRE_HEADER,
            // year to date 2026 and 2025, plus quarter-only rows that must be ignored
            ...dre('2026-09-30', 'ÚLTIMO', '2026-01-01', '2026-09-30', { receita: 900, ebit: 180, lucro: 120, controladora: 110 }, versao),
            ...dre('2026-09-30', 'ÚLTIMO', '2026-07-01', '2026-09-30', { receita: 1, ebit: 1, lucro: 1, controladora: 1 }, versao),
            ...dre('2026-09-30', 'PENÚLTIMO', '2025-01-01', '2025-09-30', { receita: 700, ebit: 150, lucro: 80, controladora: 70 }, versao),
            // an older version of the same filing must be ignored
            ...(versao > 1 ? dre('2026-09-30', 'ÚLTIMO', '2026-01-01', '2026-09-30', { receita: 0, ebit: 0, lucro: 0, controladora: 0 }, 1) : [])],
        'itr_cia_aberta_BPA_con_2026.csv': [BP_HEADER,
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '1.01.01', 'Caixa e Equivalentes de Caixa', 50],
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '1.01.02', 'Aplicações Financeiras', 30],
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'PENÚLTIMO', '2025-12-31', '1.01.01', 'Caixa e Equivalentes de Caixa', 999]],
        'itr_cia_aberta_BPP_con_2026.csv': [BP_HEADER,
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '2.01.04', 'Empréstimos e Financiamentos', 100],
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '2.02.01', 'Empréstimos e Financiamentos', 200],
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '2.02', 'Passivo Não Circulante', 400],
            [CNPJ, '2026-09-30', versao, 'EMPRESA', 'MIL', 'ÚLTIMO', '2026-09-30', '2.03', 'Patrimônio Líquido Consolidado', 600]],
    });
}

function companiesFrom(...zips) {
    const companies = new Map();
    for (const [zip, type, year] of zips) ingest(companies, zip, type, year);
    return companies;
}

describe('csv helpers', () => {
    test('readCsv decodes latin1, skips malformed lines and applies the filter', () => {
        const zip = cvmZip({ 'x.csv': [['A', 'B'], ['ação', '1'], ['broken'], ['z', '2']] });
        assert.deepEqual(readCsv(zip, 'x.csv'), [{ A: 'ação', B: '1' }, { A: 'z', B: '2' }]);
        assert.deepEqual(readCsv(zip, 'x.csv', r => r.B === '2'), [{ A: 'z', B: '2' }]);
        assert.deepEqual(readCsv(zip, 'missing.csv'), []);
    });

    test('latestVersionOnly keeps the newest version of each filing', () => {
        const rows = [
            { CNPJ_CIA: 'a', DT_REFER: 'd1', VERSAO: '1' },
            { CNPJ_CIA: 'a', DT_REFER: 'd1', VERSAO: '2' },
            { CNPJ_CIA: 'a', DT_REFER: 'd2', VERSAO: '1' },
        ];
        assert.deepEqual(latestVersionOnly(rows).map(r => `${r.DT_REFER}v${r.VERSAO}`), ['d1v2', 'd2v1']);
    });
});

describe('buildCompany', () => {
    test('computes trailing twelve months from DFP + ITR', () => {
        const companies = companiesFrom([dfp2025(), 'DFP', 2025], [itr2026(), 'ITR', 2026]);
        const c = buildCompany(CNPJ, companies.get(CNPJ));
        assert.equal(c.dataBalanco, '2026-09-30');
        assert.equal(c.financeira, false);
        // TTM = annual 2025 + 9M 2026 - 9M 2025, values in thousands
        assert.equal(c.receita, (1000 + 900 - 700) * 1000);
        assert.equal(c.ebit, (200 + 180 - 150) * 1000);
        assert.equal(c.lucro, (90 + 110 - 70) * 1000); // attributable to controlling shareholders
        assert.equal(c.patrimonio, 600_000);
        assert.equal(c.dividaLiquida, (100 + 200 - 50 - 30) * 1000);
        assert.deepEqual(c.acoes, { on: 990, pn: 500 }); // treasury shares removed, from the DFP
        // EBITDA = EBIT TTM + D&A TTM (50 + 40 - 30)
        assert.equal(c.ebitda, (230 + 60) * 1000);
        // average of (600 + 400) now and (500 + 300) at the previous year end
        assert.equal(c.capitalEmpregado, ((1000 + 800) / 2) * 1000);
    });

    test('collects the net income of each annual statement', () => {
        const dfp2024 = cvmZip({
            'dfp_cia_aberta_DRE_con_2024.csv': [DRE_HEADER,
                ...dre('2024-12-31', 'ÚLTIMO', '2024-01-01', '2024-12-31', { receita: 900, ebit: 100, lucro: -20, controladora: -25 })],
        });
        const companies = companiesFrom([dfp2024, 'DFP', 2024], [dfp2025(), 'DFP', 2025], [itr2026(), 'ITR', 2026]);
        assert.deepEqual(buildCompany(CNPJ, companies.get(CNPJ)).lucrosAnuais, [
            { ano: 2024, lucro: -25_000 },
            { ano: 2025, lucro: 90_000 },
        ]);
    });

    test('uses the latest version of a resubmitted filing', () => {
        const companies = companiesFrom([dfp2025(), 'DFP', 2025], [itr2026({ versao: 2 }), 'ITR', 2026]);
        assert.equal(buildCompany(CNPJ, companies.get(CNPJ)).receita, 1_200_000);
    });

    test('annual filing alone is used as is', () => {
        const companies = companiesFrom([dfp2025(), 'DFP', 2025]);
        const c = buildCompany(CNPJ, companies.get(CNPJ));
        assert.equal(c.receita, 1_000_000);
        assert.equal(c.lucro, 90_000);
    });

    test('TTM is null when the previous annual statement is missing', () => {
        const companies = companiesFrom([itr2026(), 'ITR', 2026], [dfp2025WithSharesOnly(), 'DFP', 2025]);
        assert.equal(buildCompany(CNPJ, companies.get(CNPJ)).receita, null);
    });

    test('falls back to total net income when the controlling line is zero', () => {
        const zip = cvmZip({
            'dfp_cia_aberta_DRE_con_2025.csv': [DRE_HEADER,
                ...dre('2025-12-31', 'ÚLTIMO', '2025-01-01', '2025-12-31', { receita: 1000, ebit: 200, lucro: 100, controladora: 0 })],
            'dfp_cia_aberta_composicao_capital_2025.csv': [CAP_HEADER, [CNPJ, '2025-12-31', 1, 1000, 0, 0, 0]],
        });
        assert.equal(buildCompany(CNPJ, companiesFrom([zip, 'DFP', 2025]).get(CNPJ)).lucro, 100_000);
    });

    test('banks have no EBIT nor net debt and use their own account codes', () => {
        const zip = cvmZip({
            'dfp_cia_aberta_DRE_con_2025.csv': [DRE_HEADER,
                [CNPJ, '2025-12-31', 1, 'BANCO', 'MIL', 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.01', 'Receitas da Intermediação Financeira', 5000],
                [CNPJ, '2025-12-31', 1, 'BANCO', 'MIL', 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.05', 'Resultado Antes dos Tributos sobre o Lucro', 900],
                [CNPJ, '2025-12-31', 1, 'BANCO', 'MIL', 'ÚLTIMO', '2025-01-01', '2025-12-31', '3.09', 'Lucro ou Prejuízo Líquido Consolidado do Período', 700]],
            'dfp_cia_aberta_BPP_con_2025.csv': [BP_HEADER,
                [CNPJ, '2025-12-31', 1, 'BANCO', 'MIL', 'ÚLTIMO', '2025-12-31', '2.03', 'Passivos Financeiros ao Custo Amortizado', 99999],
                [CNPJ, '2025-12-31', 1, 'BANCO', 'MIL', 'ÚLTIMO', '2025-12-31', '2.08', 'Patrimônio Líquido Consolidado', 4000]],
            'dfp_cia_aberta_composicao_capital_2025.csv': [CAP_HEADER, [CNPJ, '2025-12-31', 1, 1000, 0, 0, 0]],
        });
        const c = buildCompany(CNPJ, companiesFrom([zip, 'DFP', 2025]).get(CNPJ));
        assert.equal(c.financeira, true);
        assert.equal(c.ebit, null);
        assert.equal(c.dividaLiquida, null);
        assert.equal(c.lucro, 700_000);
        assert.equal(c.patrimonio, 4_000_000);
    });

    test('returns null without share data', () => {
        const zip = cvmZip({
            'dfp_cia_aberta_DRE_con_2025.csv': [DRE_HEADER,
                ...dre('2025-12-31', 'ÚLTIMO', '2025-01-01', '2025-12-31', { receita: 1, ebit: 1, lucro: 1 })],
        });
        assert.equal(buildCompany(CNPJ, companiesFrom([zip, 'DFP', 2025]).get(CNPJ)), null);
    });
});

function dfp2025WithSharesOnly() {
    return cvmZip({ 'dfp_cia_aberta_composicao_capital_2025.csv': [CAP_HEADER, [CNPJ, '2025-12-31', 1, 1000, 0, 0, 0]] });
}

const FCA_HEADER = ['CNPJ_Companhia', 'Data_Referencia', 'Versao', 'Nome_Empresarial', 'Valor_Mobiliario', 'Codigo_Negociacao', 'Mercado', 'Data_Fim_Negociacao'];

describe('readTickers', () => {
    test('maps companies to their listed share tickers', () => {
        const zip = cvmZip({
            'fca_cia_aberta_valor_mobiliario_2026.csv': [FCA_HEADER,
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Ações Ordinárias', 'EMPR3', 'Bolsa', ''],
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Ações Preferenciais', 'empr4 ', 'Bolsa', ''],
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Units', 'EMPR11', 'Bolsa', ''],
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Debêntures', 'EMPR12', 'Bolsa', ''],
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Ações Ordinárias', 'OLD3', 'Bolsa', '2020-01-01'],
                [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Ações Ordinárias', 'OTC3', 'Balcão Organizado', '']],
        });
        const tickers = readTickers([{ zip, year: 2026 }]);
        assert.deepEqual(tickers.get(CNPJ), {
            empresa: 'EMPRESA',
            tickers: [{ ticker: 'EMPR3', classe: 'ON' }, { ticker: 'EMPR4', classe: 'PN' }, { ticker: 'EMPR11', classe: 'UNIT' }],
        });
    });

    test('prefers the newest registry year', () => {
        const row = (year, ticker) => [CNPJ, `${year}-01-01`, 1, `EMPRESA ${year}`, 'Ações Ordinárias', ticker, 'Bolsa', ''];
        const z2026 = cvmZip({ 'fca_cia_aberta_valor_mobiliario_2026.csv': [FCA_HEADER, row(2026, 'NEW3')] });
        const z2025 = cvmZip({ 'fca_cia_aberta_valor_mobiliario_2025.csv': [FCA_HEADER, row(2025, 'OLD3')] });
        const tickers = readTickers([{ zip: z2026, year: 2026 }, { zip: z2025, year: 2025 }]);
        assert.deepEqual(tickers.get(CNPJ).tickers.map(t => t.ticker), ['NEW3']);
    });
});

describe('loadFundamentals', () => {
    const fca = cvmZip({
        'fca_cia_aberta_valor_mobiliario_2026.csv': [FCA_HEADER, [CNPJ, '2026-01-01', 1, 'EMPRESA', 'Ações Ordinárias', 'EMPR3', 'Bolsa', '']],
    });

    test('joins statements and tickers using the injected downloader', async () => {
        const zips = { 'DFP-2025': dfp2025(), 'ITR-2026': itr2026(), 'FCA-2026': fca };
        const requested = [];
        const download = async (doc, year) => { requested.push(`${doc}-${year}`); return zips[`${doc}-${year}`] || null; };

        const result = await loadFundamentals({ now: new Date('2026-11-05T00:00:00Z'), download });
        assert.equal(result.length, 1);
        assert.equal(result[0].empresa, 'EMPRESA');
        assert.deepEqual(result[0].tickers, [{ ticker: 'EMPR3', classe: 'ON' }]);
        assert.ok(['DFP-2021', 'DFP-2026', 'ITR-2025', 'FCA-2025'].every(r => requested.includes(r)));
    });

    test('drops companies whose last statement is too old', async () => {
        const download = async (doc, year) => ({ 'DFP-2025': dfp2025(), 'FCA-2026': fca }[`${doc}-${year}`] || null);
        const result = await loadFundamentals({ now: new Date('2027-09-01T00:00:00Z'), download });
        assert.equal(result.length, 0);
    });

    test('fails loudly when no statements are available', async () => {
        await assert.rejects(loadFundamentals({ download: async () => null }), /no CVM statements/);
    });
});
