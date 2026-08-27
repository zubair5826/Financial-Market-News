// Centralized Instrument/Request Context — Step 99. Resolves exactly
// ONE normalized instrument identity from a caller's request, so every
// provider live-source consumes the same resolved symbol instead of
// each parsing/normalizing it independently. Pure, deterministic
// resolution only — no network access, no provider call, no guessing
// a symbol from free-text query content (that would duplicate/diverge
// from orchestrator/index.js's own identifyAsset() precedence, which
// this module deliberately mirrors rather than reimplements).
//
// This module exists to fix a real production defect: providers
// previously hard-coded "SPY" regardless of what asset a caller
// actually requested, which could produce a report labeled for one
// instrument (e.g. "BTC") built from another instrument's data (SPY).
// The fix has two parts, both centralized here:
//   1. resolveInstrumentContext() — one place that decides which
//      symbol a request is actually about.
//   2. symbolsMatch() — one place that decides whether a provider's
//      returned data corresponds to what was requested, so a
//      mismatch is never silently accepted as if it were correct.

const UNKNOWN = "UNKNOWN";

// Case/whitespace normalization only — never reinterprets or maps a
// symbol to a different one (e.g. never guesses "BTC" -> "BTC-USD").
function normalizeSymbol(rawSymbol) {
  if (typeof rawSymbol !== "string") return UNKNOWN;
  const trimmed = rawSymbol.trim();
  if (!trimmed) return UNKNOWN;
  return trimmed.toUpperCase();
}

// request: the same shape processRequest() already accepts —
// { query, asset?, ... }. request.asset is the only source of truth
// for the requested symbol, mirroring orchestrator/index.js's own
// identifyAsset() precedence exactly — this module never infers a
// symbol from query text or from data payloads, since doing so here
// would be a second, independent (and possibly diverging) copy of
// that rule.
//
// options.timeframes / options.domains: optional caller-supplied
// hints (e.g. which specialist domains this context concerns) —
// never inferred, only carried through if explicitly supplied.
function resolveInstrumentContext(request, options = {}) {
  const requestedSymbol = request && typeof request.asset === "string" && request.asset.trim() ? request.asset.trim() : undefined;

  return {
    requestedSymbol: requestedSymbol || UNKNOWN,
    normalizedSymbol: requestedSymbol ? normalizeSymbol(requestedSymbol) : UNKNOWN,
    // No asset-classification (equity/crypto/fx/...) exists anywhere in
    // this system yet — never guessed here either.
    assetType: UNKNOWN,
    requestedTimeframes: Array.isArray(options.timeframes) ? options.timeframes : [],
    requestedDomains: Array.isArray(options.domains) ? options.domains : [],
  };
}

// The single, shared check every provider boundary uses to confirm
// returned data actually corresponds to what was requested.
// Case-insensitive (a provider echoing "spy" for a "SPY" request is
// not a mismatch); otherwise exact. Two UNKNOWN/undefined symbols are
// never considered a "match" — there is nothing to confirm.
function symbolsMatch(requestedSymbol, returnedSymbol) {
  if (typeof requestedSymbol !== "string" || typeof returnedSymbol !== "string") return false;
  const normalizedRequested = normalizeSymbol(requestedSymbol);
  const normalizedReturned = normalizeSymbol(returnedSymbol);
  if (normalizedRequested === UNKNOWN || normalizedReturned === UNKNOWN) return false;
  return normalizedRequested === normalizedReturned;
}

module.exports = { UNKNOWN, normalizeSymbol, resolveInstrumentContext, symbolsMatch };
