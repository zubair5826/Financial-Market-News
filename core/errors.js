// Section 7 — Error Handling. The system must fail safely: every failure
// mode below produces a structured failure object, never a fabricated
// substitute value.

const ERROR_CODES = Object.freeze({
  API_UNAVAILABLE: "API_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  RATE_LIMIT: "RATE_LIMIT",
  MALFORMED_DATA: "MALFORMED_DATA",
  MISSING_DATA: "MISSING_DATA",
  STALE_DATA: "STALE_DATA",
  CONFLICTING_DATA: "CONFLICTING_DATA",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  AUTH_FAILURE: "AUTH_FAILURE",
});

class TradingSystemError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TradingSystemError";
    this.code = code;
    this.details = details;
  }
}

// Always returns a structured failure — callers must handle `ok: false`
// explicitly instead of falling back to an invented value.
function failSafe(code, message, details = {}) {
  if (!Object.values(ERROR_CODES).includes(code)) {
    throw new Error(`Unknown error code: ${code}`);
  }
  return { ok: false, code, message, details };
}

module.exports = { ERROR_CODES, TradingSystemError, failSafe };
