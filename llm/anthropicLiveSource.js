// Anthropic Live Source — the SINGLE designated place
// process.env.ANTHROPIC_API_KEY is read anywhere in this codebase,
// mirroring providers/fredMacroLiveSource.js and
// providers/alphaVantageMarketLiveSource.js exactly.
//
// Wired in (Step 5D) via llm/reasoningService.js, which app.js calls
// strictly as an optional post-processing step — after the
// deterministic pipeline (processRequest() -> Risk Manager -> Chief
// Trading Manager) has already produced its final result, and only
// when the caller explicitly sets options.llm.enabled === true.
// Never called from the orchestrator or any agent, and never able to
// influence a deterministic decision — see app.js/
// llm/reasoningService.js and LLM_REASONING_LAYER_DESIGN.md.

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
