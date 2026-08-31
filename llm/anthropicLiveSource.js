// Anthropic Live Source — the SINGLE designated place
// process.env.ANTHROPIC_API_KEY is read anywhere in this codebase,
// mirroring providers/fredMacroLiveSource.js and
// providers/alphaVantageMarketLiveSource.js exactly. Not wired into
// app.js, the orchestrator, or any agent — nothing calls this file yet.
// A future integration phase (outside Step 5A's scope) will decide
// when/whether to call sendAnthropicMessage().

const { AnthropicAdapter } = require("./anthropicAdapter");
const { failSafe, ERROR_CODES } = require("../core/errors");

// request: same shape AnthropicAdapter#sendMessage() accepts.
// options.adapterConfig: test-only override (e.g. a fake fetchImpl or
// a shorter timeoutMs) — never used by production callers, same
// convention as fredMacroLiveSource.js's options.adapterConfig.
async function sendAnthropicMessage(request = {}, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return failSafe(ERROR_CODES.AUTH_FAILURE, "ANTHROPIC_API_KEY not configured.");
  }

  const adapter = new AnthropicAdapter({ ...(options.adapterConfig || {}), apiKey });
  return adapter.sendMessage(request);
}

module.exports = { sendAnthropicMessage };
