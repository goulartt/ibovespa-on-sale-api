const express = require('express');
const { rankStocks, DEFAULT_CRITERIA } = require('../domain/ranking');
const { HttpError } = require('../lib/httpError');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Parses an optional numeric query param within [min, max]; throws a 400 otherwise.
function numberParam(query, name, { min, max, integer = false, fallback }) {
    const raw = query[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new HttpError(400, `Parâmetro "${name}" inválido: use ${integer ? 'um inteiro' : 'um número'} entre ${min} e ${max}.`);
    }
    return value;
}

function createIbovespaRouter({ stocksRepository }) {
    const router = express.Router();

    const sendStocks = (res, dataset, stocks) => {
        res.set('X-Data-Updated-At', dataset.updatedAt);
        res.set('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
        res.json(stocks);
    };

    router.get('/all', asyncHandler(async (req, res) => {
        const dataset = await stocksRepository.getDataset();
        sendStocks(res, dataset, dataset.stocks);
    }));

    router.get('/filtered', asyncHandler(async (req, res) => {
        const criteria = {
            limit: numberParam(req.query, 'limit', { min: 1, max: 200, integer: true, fallback: DEFAULT_CRITERIA.limit }),
            minDividendYield: numberParam(req.query, 'minDy', { min: 0, max: 100, fallback: DEFAULT_CRITERIA.minDividendYield }),
        };
        const dataset = await stocksRepository.getDataset();
        sendStocks(res, dataset, rankStocks(dataset.stocks, criteria));
    }));

    return router;
}

module.exports = { createIbovespaRouter };
