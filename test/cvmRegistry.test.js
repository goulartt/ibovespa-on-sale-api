const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseIssuerStatus, loadIssuerStatus } = require('../src/sources/cvmRegistry');

const HEADER = 'CNPJ_CIA;DENOM_SOCIAL;SIT;SIT_EMISSOR;DT_INI_SIT_EMISSOR';
const CSV = [
    HEADER,
    '1;LIGHT S.A. - EM RECUPERAÇÃO JUDICIAL;ATIVO;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2023-05-16',
    '1;LIGHT S.A. - EM RECUPERAÇÃO JUDICIAL;ATIVO;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2023-05-16',
    '2;CBD;ATIVO;EM RECUPERAÇÃO EXTRAJUDICIAL;2026-10-07',
    '3;MASSA FALIDA;ATIVO;FALIDA;2019-06-10',
    '4;LIQUIDANDA;ATIVO;LIQUIDAÇÃO EXTRAJUDICIAL;2015-04-30',
    '5;PETROBRAS;ATIVO;FASE OPERACIONAL;2000-01-01',
    '6;NOVA;ATIVO;FASE PRÉ-OPERACIONAL;2025-01-01',
    '7;CANCELADA;CANCELADA;EM RECUPERAÇÃO JUDICIAL OU EQUIVALENTE;2010-01-01',
].join('\n');

describe('parseIssuerStatus', () => {
    test('maps distressed active companies to a readable situation', () => {
        const statuses = parseIssuerStatus(CSV);
        assert.deepEqual(statuses.get('1'), { situacao: 'Em recuperação judicial', desde: '2023-05-16' });
        assert.equal(statuses.get('2').situacao, 'Em recuperação extrajudicial');
        assert.equal(statuses.get('3').situacao, 'Falida');
        assert.equal(statuses.get('4').situacao, 'Em liquidação');
    });

    test('ignores normally operating and cancelled companies', () => {
        const statuses = parseIssuerStatus(CSV);
        assert.equal(statuses.has('5'), false);
        assert.equal(statuses.has('6'), false);
        assert.equal(statuses.has('7'), false);
        assert.equal(statuses.size, 4);
    });
});

describe('loadIssuerStatus', () => {
    test('decodes the latin1 file from CVM', async () => {
        const http = { get: async () => ({ data: Buffer.from(CSV, 'latin1') }) };
        assert.equal((await loadIssuerStatus({ http })).get('1').situacao, 'Em recuperação judicial');
    });

    test('fails when the file has no distressed companies (format change)', async () => {
        const http = { get: async () => ({ data: Buffer.from(HEADER, 'latin1') }) };
        await assert.rejects(loadIssuerStatus({ http }), /format may have changed/);
    });
});
