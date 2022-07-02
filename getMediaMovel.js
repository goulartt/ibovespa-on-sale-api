const axios = require('axios');
const avg = require('moving-averages');

module.exports.getHistoricalData = async function (ticker) {
    let yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let lastYear = new Date();
    lastYear.setDate(lastYear.getDate() - 365);

    const { data } = await axios.get(
        `https://query1.finance.yahoo.com/v7/finance/download/${ticker}.SA?period1=${Math.round(
            lastYear.getTime() / 1000
        )}&period2=${Math.round(
            yesterday.getTime() / 1000
        )}&interval=1d&events=history&includeAdjustedClose=true`, {
        timeout: 1000 * 10
    });


    const quotes = [];

    const lines = data.split("\n");
    for (let i = 1, l = lines.length; i < l; i++) {
        const items = lines[i].split(",");
        quotes.push({
            date: items[0],
            open: Number(items[1]),
            high: Number(items[2]),
            low: Number(items[3]),
            close: Number(items[4]),
            volume: Number(items[6]),
        });
    }

    return quotes;
};

module.exports.getMediaMovel = async function (ticker) {
    try {
        const quotes = await this.getHistoricalData(ticker);
        return {
            MA5: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 6, quotes.length), 5)[5],
            MA10: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 11, quotes.length), 10)[10],
            MA20: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 21, quotes.length), 20)[20],
            MMA50: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 51, quotes.length), 50)[50],
            MA100: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 101, quotes.length), 100)[100],
            MA200: avg.ma(quotes.map(quote => quote.close).slice(quotes.length - 201, quotes.length), 200)[200],
        }
    } catch (e) {
        console.log(e)
    }

};