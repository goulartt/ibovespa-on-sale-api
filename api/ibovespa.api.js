const express = require('express');
const _ = require('lodash');
const router = express.Router();
const getStocksInfo = require('../statusinvest');
const array = require('../recuperacaoJudicial');
const media = require('../getMediaMovel');


router.get('/all', async (req, res) => {
    try {
        const stocks = await getStocksInfo()
        res.json(stocks)
    } catch (error) {
        console.log(error);
        return res.status(500).send(error.message)
    }
})

router.get('/filtered', async (req, res) => {
    try {
        const stocks = await getStocksInfo()
        const filtered = stocks.filter(stock => {
            return stock['Liquidez Média Diária'] > 1000000 &&
                stock['Margem Ebit'] > 0 &&
                stock['Dividend Yield'] > 6 &&
                stock['Cotação'] < (((stock['Dividend Yield'] / 100) * stock['Cotação']) / 0.06) &&
                !array.RECUPERACAO_JUDICIAL.includes(stock.Ativo);
        });
        const sorted = _.orderBy(filtered, ['EV/EBIT', 'Liquidez Média Diária'], ['asc', 'desc']);
        const uniqueSorted = _.slice(_.uniqBy(sorted, a => a.Empresa), 0, 50)
        const finalStocks = await Promise.all(uniqueSorted.map(async (item, index) => {
            const medias = await media.getMediaMovel(item.Ativo);
            return {
                Ranking: index+1,
                ...item,
                ...medias
            }
        }))

        res.json(finalStocks)
    } catch (error) {
        console.log(error);
        return res.status(500).send(error.message)
    }
})

module.exports = router;