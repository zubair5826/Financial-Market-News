// Section 8 — Provider Abstraction. Base interface every future
// provider adapter must implement. No real provider is selected or
// connected here — this class cannot be instantiated directly and
// exists purely to define the contract, so providers can later be
// swapped without rewriting the agents that consume them.

class ProviderAdapter {
  constructor(config = {}) {
    if (new.target === ProviderAdapter) {
      throw new Error("ProviderAdapter is abstract and cannot be instantiated directly.");
    }
    this.config = config;
  }

  // Must resolve to either:
  //   { ok: true, data: DataRecord[] }   (see core/dataRecord.js)
  //   a failSafe() result                (see core/errors.js)
  // Must never fabricate a response when the underlying call fails.
  async fetchData(/* request */) {
    throw new Error("fetchData() must be implemented by a provider adapter subclass.");
  }

  // Optional: lets an adapter report its own connectivity/auth health.
  async healthCheck() {
    throw new Error("healthCheck() must be implemented by a provider adapter subclass.");
  }
}

module.exports = { ProviderAdapter };
