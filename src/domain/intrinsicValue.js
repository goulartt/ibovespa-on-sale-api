// Intrinsic value ("preço teto") by a simplified discounted cash flow: one year of projection
// plus a growing perpetuity (Gordon), using net income as the shareholder's cash flow.
//
//   g        = average ROE x (1 - average payout)        (growth from retained earnings)
//   FC1      = net income (last 12 months) x (1 + g)
//   r        = real yield of the ~10-year Tesouro IPCA+ with coupons + expected IPCA
//   value    = FC1 / (r - perpetual growth)              (perpetual growth = 3%)
//   discount = (value - market cap) / value;  price target = price x value / market cap
// (for a single share class, price target = value / shares, as in the original method; the ratio
// keeps it right for units and for ON/PN classes trading at different prices)

const PERPETUAL_GROWTH = 3; // % per year

// Margin of safety by how predictable the profit is (coefficient of variation of the annual
// profits): excellent, predictable companies need less margin; riskier ones, much more.
const SAFETY_MARGINS = [
    { maxVariation: 0.15, margin: 20 },
    { maxVariation: 0.30, margin: 30 },
    { maxVariation: Infinity, margin: 40 },
];

// Coefficient of variation (standard deviation / mean) of the annual profits, or null.
function profitVariation(profits) {
    if (!Array.isArray(profits) || profits.length === 0) return null;
    const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
    if (!(mean > 0)) return null;
    const variance = profits.reduce((a, p) => a + (p - mean) ** 2, 0) / profits.length;
    return Math.sqrt(variance) / mean;
}

// Margin of safety in % for a coefficient of variation (null when unknown).
function safetyMargin(variation) {
    if (variation == null || !Number.isFinite(variation)) return null;
    return SAFETY_MARGINS.find(m => variation <= m.maxVariation).margin;
}

// Pure: { tesouro, ipca } in % -> discount rates in %.
function discountRates({ tesouro, ipca, perpetualGrowth = PERPETUAL_GROWTH }) {
    const retornoExigido = tesouro + ipca;
    return { retornoExigido, crescimentoPerpetuidade: perpetualGrowth, taxaFinal: retornoExigido - perpetualGrowth };
}

// lucro / valorMercado: company net income (TTM) and market cap in BRL; preco: this ticker's
// price; roeMedio / payoutMedio: fractions (0.2 = 20%); taxaFinal in %.
// Returns null when the method doesn't apply (no profit, no market cap, non-positive rates).
function intrinsicValue({ lucro, roeMedio, payoutMedio, valorMercado, preco }, { taxaFinal }) {
    if (!(lucro > 0) || !(valorMercado > 0) || !(preco > 0) || !(taxaFinal > 0) || !(roeMedio > 0)) return null;
    const payout = Math.min(Math.max(payoutMedio ?? 0, 0), 1);
    const crescimento = roeMedio * (1 - payout);
    const fc1 = lucro * (1 + crescimento);
    const valorJusto = fc1 / (taxaFinal / 100);
    return {
        crescimento: crescimento * 100,
        payout: payout * 100,
        valorJusto,
        precoTeto: preco * (valorJusto / valorMercado),
        desconto: ((valorJusto - valorMercado) / valorJusto) * 100,
    };
}

module.exports = { intrinsicValue, discountRates, profitVariation, safetyMargin, PERPETUAL_GROWTH, SAFETY_MARGINS };
