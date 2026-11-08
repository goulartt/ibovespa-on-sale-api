// Rankings as they would have looked on a past date, with the same rules as the live site.
const { buildCompanyAsOf } = require('../sources/cvm');
const { marketAt } = require('../sources/yahoo');
const { buildStocks } = require('../domain/indicators');
const { rankStocks } = require('../domain/ranking');

// companies: cnpj -> raw CVM company (loadHistory); tickers: cnpj -> { empresa, tickers };
// registry: cnpj -> CVM registry entry (current snapshot); histories: ticker -> parseHistory().
function createRanker({ companies, tickers, registry, histories }) {
    const stocksCache = new Map();

    function stocksAt(asOf) {
        if (stocksCache.has(asOf)) return stocksCache.get(asOf);
        const list = [];
        for (const [cnpj, raw] of companies) {
            const listed = tickers.get(cnpj);
            if (!listed || listed.tickers.length === 0) continue;
            const fundamentals = buildCompanyAsOf(cnpj, raw, asOf);
            if (!fundamentals) continue;
            const info = registry.get(cnpj);
            list.push({
                ...fundamentals,
                empresa: listed.empresa,
                tickers: listed.tickers,
                // the registry is today's snapshot: a distress status only counts after it began
                situacao: info?.situacao && info.desde && info.desde <= asOf ? info.situacao : null,
                setor: info?.setor ?? null,
                instituicaoFinanceira: Boolean(info?.financeira),
            });
        }
        const market = {};
        for (const company of list) {
            for (const { ticker } of company.tickers) {
                const m = marketAt(histories[ticker], asOf);
                if (m) market[ticker] = m;
            }
        }
        const stocks = buildStocks(list, market);
        stocksCache.set(asOf, stocks);
        return stocks;
    }

    return {
        stocksAt,
        rankAt: (asOf, strategy) => rankStocks(stocksAt(asOf), { strategy, limit: Infinity }),
    };
}

module.exports = { createRanker };
