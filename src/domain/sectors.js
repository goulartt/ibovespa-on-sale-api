// Groups the ~40 CVM activity sectors (SETOR_ATIV) into 6 broad sectors (+ "Outros") for the UI.
// Holding companies come as "Emp. Adm. Part. - <sector>" and are grouped with that sector.
// Order matters: the first matching group wins.

const GROUPS = [
    ['Energia e saneamento', /energia el[ée]trica|saneamento|[áa]gua e g[áa]s/i],
    ['Financeiro', /banco|intermedia[çc][ãa]o financeira|segurador|bolsas de valores|securitiza|arrendamento|cr[ée]dito|factoring/i],
    ['Construção e imóveis', /constru[çc][ãa]o|const\. civil|mat\. const|imobili|decora/i],
    ['Commodities', /petr[óo]leo|g[áa]s|petroqu[íi]mic|qu[íi]mic|borracha|extra[çc][ãa]o mineral|minera|metalurgia|sider[úu]rgia|papel|celulose|agricultura|a[çc][úu]car|[áa]lcool|pecu[áa]ria|reflorestamento|pesca/i],
    ['Consumo', /com[ée]rcio|t[êe]xtil|vestu[áa]rio|cal[çc]ados|alimentos|bebidas|fumo|higiene|limpeza|farmac[êe]utic|m[ée]dic|sa[úu]de|hospital|educa[çc][ãa]o|brinquedos|lazer|hospedagem|turismo/i],
    ['Indústria e serviços', /m[áa]quinas|equipamentos|ve[íi]culos|pe[çc]as|embalagens|madeira|gr[áa]fica|eletroeletr|atividades industriais|transporte|log[íi]stica|rodovi|aeroporto|porto|comunica[çc][ãa]o e inform[áa]tica|telecomunica|tecnologia|software|servi[çc]os/i],
];

const OTHER = 'Outros';
const HOLDING_PREFIX = /^emp\.?\s*adm\.?\s*part\.?\s*-\s*/i;

function sectorGroup(rawSector) {
    const sector = String(rawSector || '').replace(HOLDING_PREFIX, '').trim();
    if (!sector) return null;
    const match = GROUPS.find(([, re]) => re.test(sector));
    return match ? match[0] : OTHER;
}

module.exports = { sectorGroup, SECTOR_GROUPS: [...GROUPS.map(([name]) => name), OTHER] };
