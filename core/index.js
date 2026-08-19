// Barrel export — lets consumers do `require("../core")` instead of
// reaching into each individual contract file.

module.exports = {
  ...require("./constants"),
  ...require("./classification"),
  ...require("./freshness"),
  ...require("./verification"),
  ...require("./confidence"),
  ...require("./hallucinationRules"),
  ...require("./dataRecord"),
  ...require("./agentMessage"),
  ...require("./errors"),
};
