const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sectorGroup, SECTOR_GROUPS } = require('../src/domain/sectors');

test('there are at most 7 sector groups', () => {
    assert.ok(SECTOR_GROUPS.length <= 7);
});

test('groups CVM sectors (including holdings) into broad sectors', () => {
    const cases = {
        'Energia Elétrica': 'Energia e saneamento',
        'Emp. Adm. Part. - Energia Elétrica': 'Energia e saneamento',
        'Saneamento, Serv. Água e Gás': 'Energia e saneamento',
        'Bancos': 'Financeiro',
        'Seguradoras e Corretoras': 'Financeiro',
        'Emp. Adm. Part. - Intermediação Financeira': 'Financeiro',
        'Bolsas de Valores/Mercadorias e Futuros': 'Financeiro',
        'Construção Civil, Mat. Constr. e Decoração': 'Construção e imóveis',
        'Emp. Adm. Part. - Const. Civil, Mat. Const. e Decoração': 'Construção e imóveis',
        'Petróleo e Gás': 'Commodities',
        'Petroquímicos e Borracha': 'Commodities',
        'Extração Mineral': 'Commodities',
        'Metalurgia e Siderurgia': 'Commodities',
        'Papel e Celulose': 'Commodities',
        'Agricultura (Açúcar, Álcool e Cana)': 'Commodities',
        'Comércio (Atacado e Varejo)': 'Consumo',
        'Têxtil e Vestuário': 'Consumo',
        'Emp. Adm. Part. - Alimentos': 'Consumo',
        'Bebidas e Fumo': 'Consumo',
        'Serviços Médicos': 'Consumo',
        'Educação': 'Consumo',
        'Hospedagem e Turismo': 'Consumo',
        'Máquinas, Equipamentos, Veículos e Peças': 'Indústria e serviços',
        'Embalagens': 'Indústria e serviços',
        'Serviços Transporte e Logística': 'Indústria e serviços',
        'Comunicação e Informática': 'Indústria e serviços',
        'Telecomunicações': 'Indústria e serviços',
        'Crédito Imobiliário': 'Financeiro',
        'Factoring': 'Financeiro',
        'Reflorestamento': 'Commodities',
        'Pesca': 'Commodities',
        'Outras Atividades Industriais': 'Indústria e serviços',
        'Emp. Adm. Part. - Sem Setor Principal': 'Outros',
    };
    for (const [raw, expected] of Object.entries(cases)) assert.equal(sectorGroup(raw), expected, raw);
    assert.equal(sectorGroup(''), null);
    assert.equal(sectorGroup(undefined), null);
});
