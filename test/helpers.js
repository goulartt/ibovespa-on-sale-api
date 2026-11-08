const AdmZip = require('adm-zip');

// Builds an in-memory CVM-like zip: { 'file.csv': [headerArray, ...rowArrays] }, latin1 + ';'.
function cvmZip(files) {
    const zip = new AdmZip();
    for (const [name, rows] of Object.entries(files)) {
        const csv = rows.map(r => r.join(';')).join('\n') + '\n';
        zip.addFile(name, Buffer.from(csv, 'latin1'));
    }
    return zip;
}

function stock(overrides = {}) {
    return {
        'Ativo': 'AAAA3',
        'Empresa': 'EMPRESA A',
        'Cotação': 10,
        'MA200': 9, // above the 200-day average (Deep Value uptrend rule)
        'Dividend Yield': 8,
        'EV/EBIT': 5,
        'Margem Ebit': 20,
        'Liquidez Média Diária': 5_000_000,
        'DY Médio 5 Anos': 8,
        'Anos com Dividendos': 5,
        'Payout': 50,
        'P/L': 6,
        'ROIC': 20,
        'Dívida Líquida/EBIT': 1,
        'Lucros Anuais': [2021, 2022, 2023, 2024, 2025].map(ano => ({ ano, lucro: 100 })),
        ...overrides,
    };
}

function dataset(stocks = [stock()], updatedAt = '2026-11-05T22:00:00.000Z') {
    return { updatedAt, sources: ['test'], stocks };
}

module.exports = { cvmZip, stock, dataset };
