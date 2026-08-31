// Anthropic Transport Adapter — Step 5A. Isolated transport layer for
// the Anthropic Messages API. This file contains NO prompt construction,
// NO evidence-package logic, NO output schema/validation, and NO
// hallucination guard — those belong to later, separate phases of the
// Claude/Anthropic reasoning layer (see ../LLM_REASONING_LAYER_DESIGN.md).
// This is transport only: send a messages request, get back the raw
// text/usage the API returned, or a failSafe() result.
//
// DISCLOSED ARCHITECTURAL DEVIATION: unlike every provider adapter
// under providers/adapters/, this class does NOT extend
// providers/ProviderAdapter.js. ProviderAdapter's contract
// (fetchData() -> { ok:true, data: DataRecord[] }) is shaped for
// market-data providers that return arrays of typed records; the
// Anthropic Messages API returns a single text completion plus token
// usage, which doesn't fit that shape. Rather than force-fitting a
// generic LLM transport into a market-data contract, this class is a
// standalone counterpart that mirrors the SAME structural conventions
// used by every existing adapter: constructor-injected apiKey/
// fetchImpl/timeoutMs, an AbortController-based private #request for
// real timeout cancellation, a private #parseJsonResponse that
// classifies failures into the same core/errors.js ERROR_CODES, and a
// public method that never reads process.env itself. The public
// method is named sendMessage() (not fetchData()) precisely to avoid
// implying market-data-record semantics it does not have.

const { failSafe, ERROR_CODES } = require("../core/errors");
const { UNKNOWN } = require("../core/constants");
const { getAnthropicTransportConfig } = require("./config");

class AnthropicAdapter {
  constructor(config = {}) {
    const defaults = getAnthropicTransportConfig();
    // apiKey is read from caller-supplied config only — this class
    // never reads process.env itself, same rule as every other adapter
    // in this project. See llm/anthropicLiveSource.js for the single
    // place ANTHROPIC_API_KEY is read.
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl || fetch;
    this.apiBaseUrl = config.apiBaseUrl || defaults.apiBaseUrl;
    this.apiVersion = config.apiVersion || defaults.apiVersion;
    this.model = config.model || defaults.model;
    this.maxTokens = config.maxTokens || defaults.maxTokens;
    this.timeoutMs = config.timeoutMs || defaults.timeoutMs;
  }

  // request: { messages: [{role, content}], system?: string,
  // maxTokens?: number, model?: string }. Resolves to
  // { ok: true, data: { text, model, stopReason, usage } } or a
  // failSafe() result — never a partial/fabricated response, and never
  // a silent retry (no automatic retries anywhere in this class — a
  // caller that wants a retry must decide to call sendMessage() again
  // itself).
  async sendMessage(request = {}) {
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Anthropic API key configured for this adapter instance.");
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      return failSafe(ERROR_CODES.MISSING_DATA, "sendMessage() requires a non-empty messages array.");
    }

    const body = {
      model: request.model || this.model,
      max_tokens: Number.isInteger(request.maxTokens) && request.maxTokens > 0 ? request.maxTokens : this.maxTokens,
      messages: request.messages,
    };
    if (typeof request.system === "string" && request.system.trim() !== "") {
      body.system = request.system;
    }

    const response = await this.#request(body, "Anthropic Messages API");
    if (!response.ok) return response.failure;

    const parsed = await this.#parseJsonResponse(response.value, "Anthropic Messages API");
    if (!parsed.ok) return parsed.failure;

    return this.#normalizeResponse(parsed.body);
  }

  // Same real-cancellation timeout pattern as every other adapter here
  // (providers/adapters/fredMacroAdapter.js, alphaVantage*Adapter.js).
  // The apiKey is sent only in the x-api-key header — never appended to
  // the URL, never included in any error message/details, and this
  // method's own error paths reference only `context`, never `body` or
  // the header object, so the key cannot leak into a failSafe() result.
  async #request(body, context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.apiBaseUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
        },
        body: JSON.stringify(body),
      });
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

  // Anthropic reports errors via real non-2xx HTTP status codes (unlike
  // FRED/Alpha Vantage's HTTP-200-with-error-field convention), so the
  // classification here is status-code-first.
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

    // Defensive check mirroring the other adapters' provider-reports-
    // error-in-body handling: Anthropic's documented error shape is
    // { type: "error", error: { type, message } }. In practice this
    // should already have been caught by the status-code check above,
    // but a body that reports itself as an error is never treated as
    // usable data even if the transport layer somehow saw a 2xx.
    if (body && typeof body === "object" && body.type === "error") {
      const message = body.error && typeof body.error.message === "string" ? body.error.message : "unknown error";
      return { ok: false, failure: failSafe(ERROR_CODES.INVALID_RESPONSE, `${context}: ${message}`) };
    }

    return { ok: true, body };
  }

  // Validates the response has the shape this class actually depends
  // on before trusting it — never fabricates a missing field.
  #normalizeResponse(body) {
    const textBlock =
      body && Array.isArray(body.content) ? body.content.find((block) => block && block.type === "text") : undefined;
    if (!textBlock || typeof textBlock.text !== "string") {
      return failSafe(ERROR_CODES.MALFORMED_DATA, "Anthropic Messages API response did not contain a usable text content block.");
    }
    const usage = body.usage;
    if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
      return failSafe(ERROR_CODES.MALFORMED_DATA, "Anthropic Messages API response did not contain usable usage data.");
    }

    return {
      ok: true,
      data: {
        text: textBlock.text,
        model: typeof body.model === "string" ? body.model : UNKNOWN,
        stopReason: typeof body.stop_reason === "string" ? body.stop_reason : UNKNOWN,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
      },
    };
  }
}

module.exports = { AnthropicAdapter };
