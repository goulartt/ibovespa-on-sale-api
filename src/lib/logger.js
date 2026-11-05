// Minimal leveled logger. LOG_LEVEL=silent disables output (used by the tests).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger(level = process.env.LOG_LEVEL || 'info') {
    const threshold = LEVELS[level] ?? LEVELS.info;
    const log = (name, method) => (...args) => {
        if (LEVELS[name] >= threshold) console[method](`[${name}]`, ...args);
    };
    return {
        debug: log('debug', 'debug'),
        info: log('info', 'log'),
        warn: log('warn', 'warn'),
        error: log('error', 'error'),
    };
}

module.exports = { createLogger, logger: createLogger() };
