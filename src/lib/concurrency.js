// Runs `fn` over `items` with at most `limit` calls in flight, preserving result order.
async function mapWithConcurrency(items, limit, fn) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { mapWithConcurrency, sleep };
