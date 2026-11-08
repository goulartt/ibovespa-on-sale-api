// GET /api/backtest: results of scripts/backtest.js (data/backtest.json).
const express = require('express');

function isValidBacktest(data) {
    return Boolean(data) &&
        typeof data.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(data.updatedAt)) &&
        Array.isArray(data.periodos) &&
        data.periodos.length > 0 &&
        data.periodos.every(p => p && p.estrategias && p.benchmarks);
}

function createBacktestRouter({ backtestRepository }) {
    const router = express.Router();
    router.get('/', async (req, res, next) => {
        try {
            const data = await backtestRepository.getDataset();
            res.set('X-Data-Updated-At', data.updatedAt);
            res.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
            res.json(data);
        } catch (e) {
            next(e);
        }
    });
    return router;
}

module.exports = { createBacktestRouter, isValidBacktest };
