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
        'Dividend Yield': 8,
        'EV/EBIT': 5,
        'Margem Ebit': 20,
        'Liquidez Média Diária': 5_000_000,
        ...overrides,
    };
}

function dataset(stocks = [stock()], updatedAt = '2026-11-05T22:00:00.000Z') {
    return { updatedAt, sources: ['test'], stocks };
}

module.exports = { cvmZip, stock, dataset };
