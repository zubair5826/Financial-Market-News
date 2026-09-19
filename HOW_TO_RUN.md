# How to actually run this project

This isn't a Claude Code "subagent" (a `.claude/agents/*.md` file) — it's a
real Node.js application: a multi-agent trading intelligence pipeline
(`agents/`, `orchestrator/`, `providers/`) plus an HTTP API. Node 18+,
zero dependencies, nothing to install.

## 1. Run the tests

```bash
npm test
```

Every test is synthetic, in-memory or mocked — no real network call, no
credential required. Nothing a test does touches `data/runs.jsonl` or any
real provider.

## 2. Prove the pipeline works (no internet required)

```bash
node runDemo.js
```

Feeds hand-built, clearly-labeled **sample data** (not real market data)
through all 8 agents and prints the full structured report to stdout.
It writes no file; redirect it if you want to keep a run:
`node runDemo.js > demo_output.json`.

## 3. Get a report from real, live data

The simplest way is `runAgent.js` — it takes any symbol, turns on all
three live domains by default, and prints a readable report:

```bash
node --env-file=.env runAgent.js SPY
node --env-file=.env runAgent.js MSFT --timeframes=1day,1week
node --env-file=.env runAgent.js SPY --format=json     # raw structure
node runAgent.js --help                                 # every flag
```

Position sizing is optional and all-six-or-nothing — supply every one
of these or none, and nothing is ever assumed on your behalf:

```bash
node --env-file=.env runAgent.js SPY \
  --balance=10000 --risk=0.01 --leverage=1 \
  --entry=450.25 --stop=442.00 --contract=1
```

Without them the report honestly says `POSITION SIZE: DATA_UNAVAILABLE`
and names the parameters that were missing. Supplying all six is also
what lets a run reach `TRADE_SETUP_SUPPORTED`: with sizing unavailable,
`EXECUTION_RISK` is always active, which floors risk at MODERATE and
caps the verdict at `HIGH_RISK_REVIEW_REQUIRED`.

Add `--llm` to also get the optional, isolated Claude commentary. It is
printed in a separate block clearly marked ADVISORY and never
influences `risk_decision`, `decision_status`, or `final_assessment`.

Every `runAgent.js` run is appended to `data/runs.jsonl` (override with
`RUN_STORE_FILE`), as are runs through the HTTP API.

### The older, narrower runners

Put real keys in `.env` (copy `.env.example`). **Nothing in this
project loads `.env` by itself** — there is no `dotenv` (zero
dependencies) and no entrypoint passes `--env-file`. You have to hand
the variables to the process yourself:

```bash
# Node 20.6+ can read the file directly:
node --env-file=.env runIntelligence.js "Assess SPY" "SPY"   # macro only (FRED), lightest
node --env-file=.env runLive.js                              # macro + AV candles + AV news

# Or export them, which works on every supported Node (18+):
export FRED_API_KEY="..." ALPHAVANTAGE_API_KEY="..."
node runIntelligence.js "Assess SPY" "SPY"
node runLive.js
```

If a key never reaches `process.env`, nothing crashes and nothing is
invented — that provider reports `AUTH_FAILURE` and the affected domain
comes back empty. A report that looks oddly empty is the first symptom
of a `.env` that was never loaded.

The instrument is taken from the `asset` argument and threaded through to
every instrument-specific provider — `node runIntelligence.js "Assess MSFT" "MSFT"`
really does fetch MSFT. Providers verify that the symbol they got back
matches the one requested and refuse the data if it doesn't, so a report can
never be labeled for one instrument and built from another's data.

Two honest limits worth knowing:

- **FRED series are whole-economy, not per-instrument.** The default series is
  `GNPCA` (real US GNP) — a macro backdrop, not an asset-specific signal.
  Override with `options.macroSeriesIds`.
- **`runLive.js` requests one timeframe (daily).** The market adapter supports
  `1day`, `1week` and `1month`; ask for more via `options.marketTimeframes`
  (or `runAgent.js --timeframes=`). Each extra timeframe is one more Alpha
  Vantage request, and the free tier's daily quota is small — that's why the
  default stays at one.

None of the above needs `ANTHROPIC_API_KEY`. The deterministic
pipeline never calls Claude and runs the same way with or without it.
That key only matters if you explicitly opt into the isolated,
additive reasoning layer under `llm/` (`options.llm.enabled === true`)
— see README.md's Known Limitations section.

## 4. Run the HTTP API

```bash
API_AUTH_TOKEN="pick-a-long-random-secret" npm start
```

```bash
curl -s localhost:3000/health

curl -s -X POST localhost:3000/api/intelligence \
  -H "Authorization: Bearer pick-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"request":{"query":"Assess SPY","asset":"SPY"}}'

curl -s -X POST localhost:3000/api/portfolio-intelligence \
  -H "Authorization: Bearer pick-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"text":"I have $10,000 for 5 years. I am comfortable with moderate risk."}'

# Same request shape as /api/intelligence, routed through the live
# multi-provider composition runLive.js also uses. Each domain below is
# only touched when its own options.<domain>.enabled is true.
curl -s -X POST localhost:3000/api/market-intelligence \
  -H "Authorization: Bearer pick-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"request":{"query":"Assess SPY","asset":"SPY"},"options":{"macro":{"enabled":true}}}'
```

Things to know before exposing it:

- **`API_AUTH_TOKEN` is mandatory.** Unset it and every request is rejected
  with 401 — it fails closed on purpose.
- **The server binds to `127.0.0.1` by default.** On Railway, Docker, or any
  container platform you must set `HOST=0.0.0.0` or the platform's health
  check will never reach it.
- **Set `TRUST_PROXY=1` only when a proxy in front of this process overwrites
  `X-Forwarded-For`.** With it off (the default), that header is ignored, so a
  client cannot forge it to escape rate limiting. With it on but no such proxy,
  anyone can.
- **This process does not do HTTPS.** Terminate TLS at the proxy.

`README.md` has the full table of environment variables.

## 5. Where the output goes

- `data/runs.jsonl` — one JSON line per completed run through
  `runAgent.js`, `runIntelligence.js`, `/api/intelligence` or
  `/api/market-intelligence`, credentials redacted. Override the path
  with `RUN_STORE_FILE`.
- `logs/system.log` — one structured line per agent call, rotated at 5 MB.

Both are gitignored.
