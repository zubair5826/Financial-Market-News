// FRED Macro Provider Adapter — implements the contract frozen across
// Steps 16C/17/17A/17B. This file is NOT connected to FRED: it contains
// only the request-construction/response-mapping logic; no network call
// happens unless a caller actually invokes fetchData()/healthCheck() with
// real config, which nothing in this repository does.
//
// Two-call contract (frozen): for a single requested series, this adapter
// calls fred/series (title/metadata) and fred/series/observations (data)
// as ONE atomic logical operation. Both must succeed, or no MacroRecord
// is produced — see #fetchData below. The placeholder/invented-title
// fallback is explicitly rejected per Step 17B.
//
// Data Controller is NOT part of this path — this adapter feeds
// agents/macro-agent/ directly (via MacroRecord-shaped output), never
// core/dataRecord.js or agents/data-controller/.

const { ProviderAdapter } = require("../ProviderAdapter");
const { createMacroRecord } = require("../../agents/macro-agent/macroRecord");
const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { failSafe, ERROR_CODES } = require("../../core/errors");

const FRED_BASE_URL = "https://api.stlouisfed.org/fred";
const API_VERSION = "v1";
const FRED_SOURCE_NAME = "Federal Reserve Bank of St. Louis (FRED)";
const DEFAULT_TIMEOUT_MS = 10_000;
// A clearly-synthetic placeholder used only to construct a minimal
// fred/series request for healthCheck()'s connectivity probe — this is
// NOT asserted as a real FRED series identifier (Step 18G). healthCheck()
// only cares whether a well-formed response comes back at all, never
// whether this specific id resolves to real data.
const HEALTH_CHECK_SERIES_ID = "HEALTHCHECK";

class FredMacroAdapter extends ProviderAdapter {
  constructor(config = {}) {
    super(config);
    // apiKey is read from caller-supplied config only — this class never
    // reads process.env itself; a real deployment's integration point is
    // responsible for sourcing it from the environment (see README.md's
    // Environments/Security sections) and passing it in here.
    this.apiKey = config.apiKey;
    // fetchImpl defaults to the global fetch (Node 18+) but can be
    // injected for offline/synthetic testing — see fredMacroAdapter.test.js.
    // No mocking library or new dependency is required for this.
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  // request: { seriesId: string, observationParams?: object }
  // Resolves to { ok: true, data: MacroRecord[] } or a failSafe() result —
  // never a partial/fabricated record. See module header.
  async fetchData(request) {
    if (!request || typeof request !== "object" || !request.seriesId || typeof request.seriesId !== "string") {
      return failSafe(ERROR_CODES.MALFORMED_DATA, "FredMacroAdapter.fetchData requires request.seriesId (string).");
    }
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No FRED API key configured for this adapter instance.");
    }

    const seriesId = request.seriesId;

    const metadataResult = await this.#fetchSeriesMetadata(seriesId);
    if (!metadataResult.ok) return metadataResult.failure;

    const observationsResult = await this.#fetchSeriesObservations(seriesId, request.observationParams || {});
    if (!observationsResult.ok) return observationsResult.failure;

    const retrievedTimestamp = new Date().toISOString();
    const records = this.#mapToMacroRecords(
      seriesId,
      metadataResult.title,
      observationsResult.units,
      observationsResult.observations,
      retrievedTimestamp
    );

    return { ok: true, data: records };
  }

  // Design approved in Step 18F, implemented in Step 18G: fails fast on a
  // missing key (no network call, unchanged from the original Step 18
  // behavior), otherwise performs exactly one connectivity probe against
  // the already-frozen fred/series endpoint — reusing #buildUrl/#request/
  // #parseJsonResponse verbatim (the same machinery fetchData() already
  // uses), so every timeout/cancellation/error-classification/credential-
  // safety guarantee those methods provide is inherited for free, with no
  // second, independent network implementation introduced. Never returns
  // a MacroRecord, and never claims more than "a response was received" —
  // see module comment on HEALTH_CHECK_SERIES_ID.
  async healthCheck() {
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No FRED API key configured for this adapter instance.");
    }

    const url = this.#buildUrl("/series", { series_id: HEALTH_CHECK_SERIES_ID });
    const response = await this.#request(url, "FRED connectivity check");
    if (!response.ok) return response.failure;

    const parsed = await this.#parseJsonResponse(response.value, "FRED connectivity check");
    if (!parsed.ok) return parsed.failure;

    return { ok: true, message: "FRED connectivity check succeeded." };
  }

  async #fetchSeriesMetadata(seriesId) {
    const url = this.#buildUrl("/series", { series_id: seriesId });
    const response = await this.#request(url, "FRED series metadata");
    if (!response.ok) return response;

    const parsed = await this.#parseJsonResponse(response.value, "FRED series metadata");
    if (!parsed.ok) return parsed;

    const body = parsed.body;
    const series = Array.isArray(body.seriess) ? body.seriess[0] : undefined;
    if (!series || typeof series.title !== "string" || series.title.length === 0) {
      return {
        ok: false,
        failure: failSafe(ERROR_CODES.MALFORMED_DATA, "FRED series metadata response did not contain a usable title.", {
          seriesId,
        }),
      };
    }

    return { ok: true, title: series.title };
  }

  async #fetchSeriesObservations(seriesId, observationParams) {
    const url = this.#buildUrl("/series/observations", { series_id: seriesId, ...observationParams });
    const response = await this.#request(url, "FRED series observations");
    if (!response.ok) return response;

    const parsed = await this.#parseJsonResponse(response.value, "FRED series observations");
    if (!parsed.ok) return parsed;

    const body = parsed.body;
    if (!Array.isArray(body.observations)) {
      return {
        ok: false,
        failure: failSafe(ERROR_CODES.MALFORMED_DATA, "FRED series observations response did not contain an observations array.", {
          seriesId,
        }),
      };
    }

    return { ok: true, units: typeof body.units === "string" ? body.units : UNKNOWN, observations: body.observations };
  }

  // Issues the HTTP request with real cancellation: an AbortController's
  // signal is passed to fetchImpl (the same way a real fetch(url, {signal})
  // call would receive it), and the controller is aborted when timeoutMs
  // elapses — so the underlying request is actually told to stop, not just
  // raced against a timer that leaves it running in the background
  // (Step 18C's disclosed concern). Network/timeout failures are still
  // distinguished by AbortError vs. any other rejection; a well-behaved
  // fetchImpl (including Node's real global fetch) rejects with an
  // AbortError-named error when its signal is aborted.
  async #request(url, context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      return { ok: true, value: response };
    } catch (err) {
      if (err && err.name === "AbortError") {
        return { ok: false, failure: failSafe(ERROR_CODES.TIMEOUT, `${context} request timed out.`) };
      }
      return { ok: false, failure: failSafe(ERROR_CODES.API_UNAVAILABLE, `${context} request failed: network error.`) };
    } finally {
      clearTimeout(timer);
    }
  }

  async #parseJsonResponse(response, context) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, failure: failSafe(ERROR_CODES.AUTH_FAILURE, `${context} request was rejected: authentication failed.`) };
    }
    if (response.status === 429) {
      return { ok: false, failure: failSafe(ERROR_CODES.RATE_LIMIT, `${context} request was rejected: rate limit exceeded.`) };
    }
    if (!response.ok) {
      return {
        ok: false,
        failure: failSafe(ERROR_CODES.API_UNAVAILABLE, `${context} request failed with HTTP ${response.status}.`),
      };
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      return { ok: false, failure: failSafe(ERROR_CODES.MALFORMED_DATA, `${context} response was not valid JSON.`) };
    }

    if (body && typeof body === "object" && (body.error_code !== undefined || body.code !== undefined)) {
      const message = body.error_message || body.message || "FRED reported an error.";
      return { ok: false, failure: failSafe(ERROR_CODES.INVALID_RESPONSE, `${context}: ${message}`) };
    }

    return { ok: true, body };
  }

  // "." is FRED's documented sentinel for a missing observation — mapped
  // to UNKNOWN, never 0, never fabricated. See Step 16A/18 frozen rule.
  // Empty/whitespace-only strings are guarded explicitly too: JavaScript's
  // Number("") and Number("   ") both evaluate to 0, which would silently
  // fabricate a zero reading for a genuinely missing value — Step 18A.
  #parseObservationValue(rawValue) {
    if (rawValue === "." || rawValue === undefined || rawValue === null) return UNKNOWN;
    if (typeof rawValue === "string" && rawValue.trim() === "") return UNKNOWN;
    const num = Number(rawValue);
    return Number.isFinite(num) ? num : UNKNOWN;
  }

  #mapToMacroRecords(seriesId, title, units, observations, retrievedTimestamp) {
    return observations.map((obs) =>
      createMacroRecord({
        indicator: title,
        indicator_code: seriesId,
        unit: units,
        period: obs && obs.date ? obs.date : UNKNOWN,
        actual_value: this.#parseObservationValue(obs ? obs.value : undefined),
        source: FRED_SOURCE_NAME,
        // release_timestamp is deliberately never set here — it stays
        // UNKNOWN via createMacroRecord's own default. FRED supplies no
        // genuine publication timestamp; this must never be derived from
        // realtime_start, realtime_end, period, or retrieved_timestamp.
        // Frozen: Step 16C, reaffirmed Step 18.
        retrieved_timestamp: retrievedTimestamp,
        classification: INFORMATION_CLASSIFICATIONS.FACT,
        evidence: {
          fred_series_id: seriesId,
          realtime_start: obs && obs.realtime_start ? obs.realtime_start : UNKNOWN,
          realtime_end: obs && obs.realtime_end ? obs.realtime_end : UNKNOWN,
          api_version: API_VERSION,
          endpoint: "series/observations",
        },
      })
    );
  }

  // Builds the request URL. Never logged or included in any failSafe()
  // message/details — the api_key query parameter must never leak into
  // logs or error output (Step 15/18 security rule).
  #buildUrl(path, params) {
    const url = new URL(`${FRED_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("file_type", "json");
    return url.toString();
  }
}

module.exports = { FredMacroAdapter };
