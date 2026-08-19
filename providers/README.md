# Providers

Foundation only — no provider is selected, configured, or connected.

## Status

- `ProviderAdapter.js` — abstract base class every future provider
  adapter must extend. Cannot be instantiated directly.
- No concrete adapters exist yet.
- No provider has been chosen. Market data, news, macroeconomic, and
  broker/exchange providers (e.g. Alpha Vantage, Polygon, Finnhub,
  CoinGecko, NewsAPI, FRED, or any other) are all **UNKNOWN** until
  explicitly selected by the project owner. None are assumed.

## Contract

Every adapter must implement:

- `fetchData(request)` → resolves to `{ ok: true, data: DataRecord[] }`
  (see `core/dataRecord.js` for the record shape) or a `failSafe()`
  result (see `core/errors.js`). Must never fabricate data on failure.
- `healthCheck()` → reports the adapter's own connectivity/auth state.

This lets a provider be swapped later without changing any agent code,
since agents will depend on the adapter interface, not a specific
provider's API shape.
