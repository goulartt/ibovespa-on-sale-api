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
| `GET /api/ibovespa/filtered` | Ranking (critérios abaixo). Parâmetros opcionais: `strategy` (`deepValue`, `dividendos` — padrão por compatibilidade —, `qualidade` ou `valorIntrinseco`), `sort` (`evEbit`, padrão, ou `magicFormula`), `limit` (1–500, padrão 50) e `minDy` (0–100, padrão 6). |
| `GET /api/ibovespa/all` | Todas as ações com indicadores. |
| `GET /api/ibovespa/premissas` | Premissas do valor intrínseco do dia (Tesouro IPCA+, IPCA esperado e taxas). |
| `GET /api/backtest` | Resultado do backtest (`data/backtest.json`, veja abaixo). |
| `GET /api/health` | Status e data da última atualização (`stale` se tiver mais de 4 dias). |

### Estratégia `deepValue`

- Só os filtros comuns + EBIT positivo, ordenado pelo maior EBIT/EV (EV/EBIT invertido).
- Sem bancos, seguradoras e holdings financeiras (campo `Instituição Financeira`): identificados pelo
  formato da DRE ou pelo setor da CVM; corretoras de seguros, como Wiz e Qualicorp, continuam.
  Nas outras estratégias, bancos no formato bancário ficam de fora naturalmente por não terem EBIT.

### Estratégia `dividendos`

- Liquidez média diária > R$ 1 mi e margem EBIT positiva.
- DY de 12 meses > 6% e DY médio de 5 anos > 5% (exclui dividendos extraordinários).
- Payout ≤ 120% e proventos pagos em pelo menos 3 dos últimos 5 anos.
- Lucro em todos os últimos balanços anuais (mínimo 3) e nos últimos 12 meses.
- Dívida líquida / EBIT < 3 (4,5 em Energia e saneamento).
- Fora de recuperação judicial/extrajudicial, falência ou liquidação (cadastro da CVM).
Cada ação também traz o **preço teto de Bazin** (`Preço Teto Bazin` = dividendo médio por ação dos
últimos 5 anos ÷ 6%) e o `Desconto Bazin`; o site permite filtrar a lista de dividendos pelas ações
abaixo dele.

### Estratégia `qualidade` (qualidade a bom preço)

- ROCE > 15%: EBIT dos últimos 12 meses ÷ capital empregado médio (patrimônio líquido + passivo
  não circulante, média entre o último balanço e o do fim do ano anterior).
- Dívida líquida / EBITDA < 1,5 (EBITDA = EBIT + depreciação e amortização da DVA, 12 meses).
- P/L entre 0 e 15.

### Estratégia `valorIntrinseco` (preço teto)

Fluxo de caixa descontado simplificado (um ano de projeção + perpetuidade), ordenado pelo desconto:

- crescimento `g` = ROE médio dos balanços anuais × (1 − payout médio de 5 anos);
- fluxo do próximo ano = lucro líquido dos últimos 12 meses × (1 + g);
- taxa = Tesouro IPCA+ com juros semestrais mais próximo de 10 anos (Tesouro Transparente) + IPCA
  esperado para 12 meses (Boletim Focus) − 3% de crescimento na perpetuidade;
- valor justo = fluxo ÷ taxa; desconto = (valor justo − valor de mercado) ÷ valor justo; o preço teto
  de cada ativo é proporcional ao seu preço (vale para units e classes ON/PN);
- só empresas com lucro previsível: lucro em todos os últimos anos (mín. 3), variação de até 50% da
  média e lucro de 12 meses entre 0,5× e 2× a média anual. Bancos e seguradoras entram.

### Comum às duas

- Liquidez média diária > R$ 1 mi e fora de recuperação judicial/extrajudicial, falência ou liquidação.
- Ordenação pelo maior EBIT/EV (empresas com EV negativo ficam no fim).
- Cada ação traz o `Setor`: o setor de atividade da CVM agrupado em Energia e saneamento,
  Commodities, Construção e imóveis, Financeiro, Consumo, Indústria e serviços ou Outros.
- Ordenação por EV/EBIT ou pela Fórmula Mágica (posição no EV/EBIT + posição no ROIC); uma ação por empresa.

As respostas trazem o cabeçalho `X-Data-Updated-At`. Erros retornam JSON `{ "error": "..." }`.

## Backtest

`npm run backtest` (cerca de 10 minutos e 10 GB de memória; roda todo mês em
`.github/workflows/backtest.yml`) simula as 20 primeiras de cada estratégia (10 em Dividendos, cuja lista é naturalmente curta) de jan/2014 até hoje e
compara com o CDI (Banco Central, série SGS 12) e o Ibovespa, em três períodos: completo, 2014–2019
(usado para escolher as regras) e 2020–hoje (validação). Também compara as regras atuais com as
anteriores (`PREVIOUS_RULES` em `src/domain/ranking.js`) e conta, de 12 carteiras iniciadas em cada
janeiro, quantas bateram o CDI.

- **Sem olhar o futuro:** em cada data, os rankings são recalculados com as mesmas regras do site,
  usando só os balanços já entregues à CVM (`DT_RECEB`), as cotações e os proventos até o pregão
  anterior. O preço é convertido para o número de ações da época (desfazendo desdobramentos posteriores).
- **Número de ações antes de 2020:** do histórico do capital social no Formulário de Referência
  (FRE), porque a composição do capital nos ITR/DFP só existe desde 2020.
- **Comprar e segurar** ou **rotação trimestral** (primeiros pregões após 5/abr, 20/mai, 20/ago e
  20/nov): vende quem saiu do top 40 ou dos filtros e compra as mais bem colocadas fora da carteira.
- Retorno total (proventos reinvestidos), 0,1% de custo por operação, caixa rendendo CDI e ativos sem
  cotação por 10 pregões convertidos em caixa.
- Limitações: viés de sobrevivência (cerca de um terço dos códigos desde 2014 não tem histórico no
  Yahoo), cadastro da CVM atual e balanços reapresentados (versão final com a data da primeira entrega).

### Pesquisa de variações

`scripts/research/` testa variações das estratégias sobre uma base em cache:

```bash
node --max-old-space-size=10240 scripts/research/build-cache.js /tmp/cache.v8 2014
node --max-old-space-size=10240 scripts/research/run.js /tmp/cache.v8 scripts/research/variants.js
```

Resultados de nov/2026 (top 20, rotação trimestral, retorno ao ano; CDI de 9,9% em 2014–2019 e
10,0% em 2020–2026): a média móvel de 200 pregões no Deep Value levou a validação de 7,1% para 13,4%
ao ano; o lucro estável na Qualidade, de 5,0% para 11,6%. Manter a Qualidade até P/L 25, rotação
semestral ou anual e a Fórmula Mágica não ajudaram.

## Desenvolvimento

```bash
npm ci
npm test               # testes (node:test)
npm run test:coverage  # com cobertura
npm run build:data     # baixa CVM + Yahoo e gera data/stocks.json (~1 min)
npm run backtest       # gera data/backtest.json (~5 min)
npm start              # http://localhost:8080
```

Variáveis de ambiente opcionais: `PORT`, `STOCKS_DATA_URL`, `BACKTEST_DATA_URL`, `STOCKS_CACHE_TTL_MS`,
`HTTP_TIMEOUT_MS`, `STALE_AFTER_MS`, `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).

## Estrutura

```
index.js                         entrada (Vercel / npm start)
src/app.js                       app Express, health, 404 e tratamento de erros
src/routes/ibovespa.js           rotas e validação de parâmetros
src/routes/backtest.js           rota do backtest
src/domain/ranking.js            critérios do ranking
src/domain/indicators.js         cálculo dos indicadores
src/sources/cvm.js               leitura dos dados abertos da CVM
src/sources/yahoo.js             cotações e dividendos (atuais e históricos)
src/sources/benchmarks.js        CDI (Banco Central)
src/domain/intrinsicValue.js     valor intrínseco (preço teto)
src/sources/rates.js             Tesouro IPCA+ e IPCA esperado (Focus)
src/backtest/engine.js           simulação das carteiras e métricas
src/backtest/pointInTime.js      rankings em datas passadas
src/repository/stocksRepository.js  carga e cache do dataset
scripts/build-data.js            geração do data/stocks.json
scripts/backtest.js              geração do data/backtest.json
test/                            testes
```

## Limitações

- O nº de ações da CVM não informa a unidade; empresas que reportam em milhares são detectadas
  por um P/VP implausível.
- Bancos e seguradoras não têm EBIT/EV, então ficam fora do ranking.
- O DY usa os proventos do Yahoo, que incluem dividendos extraordinários.
- Empresas em recuperação judicial/extrajudicial, falência ou liquidação são identificadas pelo
  cadastro da CVM (`cad_cia_aberta.csv`, campo `SIT_EMISSOR`) a cada atualização dos dados.
