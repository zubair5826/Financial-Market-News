// Anthropic Transport Configuration — Step 5A. Non-secret configuration
// only — the API key itself is never read or stored here; see
// llm/anthropicLiveSource.js for the single place
// process.env.ANTHROPIC_API_KEY is read, mirroring the exact rule
// already enforced for FRED_API_KEY (providers/fredMacroLiveSource.js)
// and ALPHAVANTAGE_API_KEY (providers/alphaVantageMarketLiveSource.js/
// alphaVantageNewsLiveSource.js).
//
// This file intentionally contains NO prompt, no evidence-package
// logic, and no output schema — those belong to a later, separate
// phase of the Claude/Anthropic reasoning layer (see
// ../LLM_REASONING_LAYER_DESIGN.md, Step 4's approved design). This is
// transport-level configuration only: which model to call, how long to
// wait, and how large a response to allow.

// Anthropic's own wire-protocol constants — not secrets, safe to
// hard-code, identical for every caller of the real API.
const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Pinned, not "latest" — reproducibility rule from
// LLM_REASONING_LAYER_DESIGN.md §5 ("never 'latest' in production").
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 600;

const ANTHROPIC_TRANSPORT_CONFIG = Object.freeze({
  apiBaseUrl: ANTHROPIC_API_BASE_URL,
  apiVersion: ANTHROPIC_API_VERSION,
  model: DEFAULT_MODEL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTokens: DEFAULT_MAX_TOKENS,
});

// Returns the frozen config object above. A function (rather than
// exporting the constant alone) so every future caller has one
// obvious, greppable call site, mirroring
// config/freshness.js's getFreshnessThresholds() convention.
function getAnthropicTransportConfig() {
  return ANTHROPIC_TRANSPORT_CONFIG;
}

module.exports = { ANTHROPIC_TRANSPORT_CONFIG, getAnthropicTransportConfig };
