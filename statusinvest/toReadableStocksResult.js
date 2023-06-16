const toReadableStocksResult = (statusInvestStock) => {
    return {
        'Ativo': statusInvestStock.ticker,
        'Empresa': statusInvestStock.companyname,
        'Cotação': statusInvestStock.price,
        'P/L': statusInvestStock.p_l,
        'P/VP': statusInvestStock.p_vp,
        'PSR': statusInvestStock.p_sr,
        'Dividend Yield': statusInvestStock.dy,
        'P/Ativo': statusInvestStock.p_ativo,
        'P/Capital de Giro': statusInvestStock.p_capitalgiro,
        'P/EBIT': statusInvestStock.p_ebit,
        'P/ACL': statusInvestStock.p_ativocirculante,
        'EV/EBIT': statusInvestStock.ev_ebit,
        'Margem Ebit': statusInvestStock.margemebit,
        'Margem Líquida': statusInvestStock.margemliquida,
        'Liquidez Corrente': statusInvestStock.liquidezcorrente,
        'ROIC': statusInvestStock.roic,
        'ROE': statusInvestStock.roe,
        'CAGR Lucros 5 Anos': statusInvestStock.lucros_cagr5,
        'CAGR Receitas 5 Anos': statusInvestStock.receitas_cagr5,
        'Dívida Líquida/Patrimônio': statusInvestStock.dividaliquida_patrimonioliquido,
        'Dívida Líquida/EBIT': statusInvestStock.dividaliquida_ebit,
        'ROA': statusInvestStock.roa,
        'PL/Ativos': statusInvestStock.pl_ativos,
        'Giro Ativos': statusInvestStock.giroativos,
        'Margem Bruta': statusInvestStock.margembruta,
        'Passivo/Ativo': statusInvestStock.passivo_ativo,
        'Liquidez Média Diária': statusInvestStock.liquidezmediadiaria
    }
}

module.exports = toReadableStocksResult