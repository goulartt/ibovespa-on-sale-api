const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistry, loadRegistry } = require('../src/sources/cvmRegistry');

const HEADER = 'CNPJ_CIA;DENOM_SOCIAL;SIT;SIT_EMISSOR;DT_INI_SIT_EMISSOR;SETOR_ATIV';
const ROWS = [
    '1;LIGHT S.A. - EM RECUPERAÇÃO JUDICIAL;ATIVO;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2023-05-16;Energia Elétrica',
    '1;LIGHT S.A. - EM RECUPERAÇÃO JUDICIAL;ATIVO;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2023-05-16;Energia Elétrica',
    '2;CBD;ATIVO;EM RECUPERAÇÃO EXTRAJUDICIAL;2026-10-07;Comércio (Atacado e Varejo)',
    '3;MASSA FALIDA;ATIVO;FALIDA;2019-06-10;Farmacêutico e Higiene',
    '4;LIQUIDANDA;ATIVO;LIQUIDAÇÃO EXTRAJUDICIAL;2015-04-30;Emp. Adm. Part. - Sem Setor Principal',
    '5;PETROBRAS;ATIVO;FASE OPERACIONAL;2000-01-01;Petróleo e Gás',
    '6;NOVA;ATIVO;FASE PRÉ-OPERACIONAL;2025-01-01;',
    '7;CANCELADA;CANCELADA;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2010-01-01;Bancos',
];
const CSV = [HEADER, ...ROWS].join('\n');

describe('parseRegistry', () => {
    test('maps distressed companies to a readable situation', () => {
        const r = parseRegistry(CSV);
        assert.deepEqual(r.get('1'), { situacao: 'Em recuperação judicial', desde: '2023-05-16', setor: 'Energia e saneamento' });
        assert.equal(r.get('2').situacao, 'Em recuperação extrajudicial');
        assert.equal(r.get('3').situacao, 'Falida');
        assert.equal(r.get('4').situacao, 'Em liquidação');
    });

    test('normally operating companies have no situation but keep their sector', () => {
        const r = parseRegistry(CSV);
        assert.deepEqual(r.get('5'), { situacao: null, desde: null, setor: 'Commodities' });
        assert.deepEqual(r.get('6'), { situacao: null, desde: null, setor: null });
    });

    test('ignores cancelled companies', () => {
        assert.equal(parseRegistry(CSV).has('7'), false);
    });
});

describe('loadRegistry', () => {
    const many = Array.from({ length: 120 }, (_, i) => `${100 + i};CIA ${i};ATIVO;FASE OPERACIONAL;2000-01-01;Bancos`);

    test('decodes the latin1 file from CVM', async () => {
        const http = { get: async () => ({ data: Buffer.from([HEADER, ...ROWS, ...many].join('\n'), 'latin1') }) };
        const r = await loadRegistry({ http });
        assert.equal(r.get('1').situacao, 'Em recuperação judicial');
        assert.equal(r.get('150').setor, 'Financeiro');
    });

    test('fails when the file looks wrong (format change)', async () => {
        const empty = { get: async () => ({ data: Buffer.from(HEADER, 'latin1') }) };
        await assert.rejects(loadRegistry({ http: empty }), /format may have changed/);
        const noDistressed = { get: async () => ({ data: Buffer.from([HEADER, ...many].join('\n'), 'latin1') }) };
        await assert.rejects(loadRegistry({ http: noDistressed }), /format may have changed/);
    });
});
