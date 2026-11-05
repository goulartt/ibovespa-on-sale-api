const express = require('express');
const _ = require('lodash');
const router = express.Router();
const { getStocks } = require('../stocks');
const array = require('../recuperacaoJudicial');

router.get('/all', async (req, res) => {
    try {
        const { stocks, updatedAt } = await getStocks()
        res.set('X-Data-Updated-At', updatedAt)
        res.json(stocks)
    } catch (error) {
        console.log(error);
        return res.status(500).send(error.message)
    }
})

router.get('/filtered', async (req, res) => {
    try {
        const { stocks, updatedAt } = await getStocks()
        const filtered = stocks.filter(stock => {
            return stock['Liquidez Média Diária'] > 1000000 &&
                stock['Margem Ebit'] > 0 &&
                stock['Dividend Yield'] > 6 &&
                stock['EV/EBIT'] != null &&
                !array.RECUPERACAO_JUDICIAL.includes(stock.Ativo);
        });
        const sorted = _.orderBy(filtered, ['EV/EBIT', 'Liquidez Média Diária'], ['asc', 'desc']);
        const uniqueSorted = _.slice(_.uniqBy(sorted, a => a.Empresa), 0, 50)
        const finalStocks = uniqueSorted.map((item, index) => ({
            Ranking: index + 1,
            ...item
        }))

        res.set('X-Data-Updated-At', updatedAt)
        res.json(finalStocks)
    } catch (error) {
        console.log(error);
        return res.status(500).send(error.message)
    }
})

module.exports = router;
