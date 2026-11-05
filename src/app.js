const express = require('express');
const cors = require('cors');
const { createIbovespaRouter } = require('./routes/ibovespa');
const { HttpError } = require('./lib/httpError');
const { logger: defaultLogger } = require('./lib/logger');

function createApp({ stocksRepository, logger = defaultLogger, staleAfterMs = Infinity, now = Date.now }) {
    const app = express();
    app.disable('x-powered-by');
    app.use(cors({ exposedHeaders: ['X-Data-Updated-At'] }));

    app.get('/api/health', async (req, res, next) => {
        try {
            const { updatedAt, stocks } = await stocksRepository.getDataset();
            const ageMs = now() - Date.parse(updatedAt);
            res.set('Cache-Control', 'no-store');
            res.json({ status: ageMs > staleAfterMs ? 'stale' : 'ok', dataUpdatedAt: updatedAt, stocks: stocks.length });
        } catch (e) {
            next(e);
        }
    });

    app.use('/api/ibovespa', createIbovespaRouter({ stocksRepository }));

    app.use((req, res, next) => next(new HttpError(404, 'Rota não encontrada.')));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const status = err instanceof HttpError ? err.status : 500;
        if (status >= 500) logger.error(`${req.method} ${req.originalUrl} failed:`, err);
        res.status(status).json({
            error: status >= 500 ? 'Erro interno ao processar a requisição.' : err.message,
        });
    });

    return app;
}

module.exports = { createApp };
