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
| `GET /api/ibovespa/filtered` | Ranking: liquidez > R$ 1 mi/dia, margem EBIT > 0, DY > 6%, fora de recuperação judicial, ordenado por EV/EBIT. Parâmetros opcionais: `limit` (1–200, padrão 50) e `minDy` (0–100, padrão 6). |
| `GET /api/ibovespa/all` | Todas as ações com indicadores. |
| `GET /api/health` | Status e data da última atualização (`stale` se tiver mais de 4 dias). |

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
- A lista de empresas em recuperação judicial (`src/domain/recuperacaoJudicial.js`) é manual.
