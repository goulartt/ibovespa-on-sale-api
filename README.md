# ibovespa-on-sale-api

API do [Ibovespa em Promoção](https://goulartt.github.io/ibovespa-on-sale/): ranking de ações da B3
com bons dividendos negociadas a múltiplos baixos.

## Como funciona

```
CVM dados abertos (DFP/ITR/FCA) ─┐
                                 ├─► scripts/build-data.js ─► data/stocks.json ─► API (Vercel)
Yahoo Finance (v8 chart) ────────┘        (GitHub Actions, dias úteis 19h30)
```

- **Fundamentos** (receita, EBIT, lucro, dívida, patrimônio, nº de ações) vêm dos demonstrativos
  enviados à CVM, acumulados nos últimos 12 meses (último anual + acumulado do ano − mesmo período
  do ano anterior).
- **Mercado** (cotação, liquidez média de 3 meses, dividendos de 12 meses, médias móveis) vem do Yahoo.
- A API não acessa fontes externas por requisição: lê o `data/stocks.json` mais recente do GitHub
  (cache de 10 min) e, se falhar, usa a cópia publicada junto com o deploy.

## Endpoints

| Rota | Descrição |
| --- | --- |
| `GET /api/ibovespa/filtered` | Ranking (critérios abaixo). Parâmetros opcionais: `strategy` (`dividendos`, padrão, ou `qualidade`), `sort` (`evEbit`, padrão, ou `magicFormula`), `limit` (1–200, padrão 50) e `minDy` (0–100, padrão 6). |
| `GET /api/ibovespa/all` | Todas as ações com indicadores. |
| `GET /api/health` | Status e data da última atualização (`stale` se tiver mais de 4 dias). |

### Estratégia `dividendos` (padrão)

- Liquidez média diária > R$ 1 mi e margem EBIT positiva.
- DY sustentável > 6%: o menor entre o DY de 12 meses e o DY médio de 5 anos (exclui dividendos extraordinários).
- Payout ≤ 100% e proventos pagos em pelo menos 3 dos últimos 5 anos.
- Lucro em todos os últimos balanços anuais (mínimo 3) e nos últimos 12 meses.
- Dívida líquida / EBIT < 3.
- Fora de recuperação judicial/extrajudicial, falência ou liquidação (cadastro da CVM).
### Estratégia `qualidade` (qualidade a bom preço)

- ROCE > 15%: EBIT dos últimos 12 meses ÷ capital empregado médio (patrimônio líquido + passivo
  não circulante, média entre o último balanço e o do fim do ano anterior).
- Dívida líquida / EBITDA < 1 (EBITDA = EBIT + depreciação e amortização da DVA, 12 meses).
- P/L entre 0 e 10.

### Comum às duas

- Liquidez média diária > R$ 1 mi e fora de recuperação judicial/extrajudicial, falência ou liquidação.
- Cada ação traz o `Setor`: o setor de atividade da CVM agrupado em Energia e saneamento,
  Commodities, Construção e imóveis, Financeiro, Consumo, Indústria e serviços ou Outros.
- Ordenação por EV/EBIT ou pela Fórmula Mágica (posição no EV/EBIT + posição no ROIC); uma ação por empresa.

As respostas trazem o cabeçalho `X-Data-Updated-At`. Erros retornam JSON `{ "error": "..." }`.

## Desenvolvimento

```bash
npm ci
npm test               # testes (node:test)
npm run test:coverage  # com cobertura
npm run build:data     # baixa CVM + Yahoo e gera data/stocks.json (~1 min)
npm start              # http://localhost:8080
```

Variáveis de ambiente opcionais: `PORT`, `STOCKS_DATA_URL`, `STOCKS_CACHE_TTL_MS`,
`HTTP_TIMEOUT_MS`, `STALE_AFTER_MS`, `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).

## Estrutura

```
index.js                         entrada (Vercel / npm start)
src/app.js                       app Express, health, 404 e tratamento de erros
src/routes/ibovespa.js           rotas e validação de parâmetros
src/domain/ranking.js            critérios do ranking
src/domain/indicators.js         cálculo dos indicadores
src/sources/cvm.js               leitura dos dados abertos da CVM
src/sources/yahoo.js             cotações e dividendos
src/repository/stocksRepository.js  carga e cache do dataset
scripts/build-data.js            geração do data/stocks.json
test/                            testes
```

## Limitações

- O nº de ações da CVM não informa a unidade; empresas que reportam em milhares são detectadas
  por um P/VP implausível.
- Bancos e seguradoras não têm EBIT/EV, então ficam fora do ranking.
- O DY usa os proventos do Yahoo, que incluem dividendos extraordinários.
- Empresas em recuperação judicial/extrajudicial, falência ou liquidação são identificadas pelo
  cadastro da CVM (`cad_cia_aberta.csv`, campo `SIT_EMISSOR`) a cada atualização dos dados.
