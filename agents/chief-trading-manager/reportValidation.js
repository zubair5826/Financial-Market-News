// "Never treat one agent as automatically correct" starts with never
// blindly trusting what's handed in. Before using any of the six
// supplied reports, confirm it structurally looks like a real report
// from that agent — right agent_name, the fields this agent actually
// depends on. A report that fails this check is treated as NOT
// SUPPLIED, never repaired or guessed at. Mirrors
// agents/trade-setup-agent/reportValidation.js and
// agents/risk-manager/reportValidation.js, kept as its own copy per
// this project's established pattern of not cross-importing between
// agent folders.

const REQUIRED_FIELDS = Object.freeze({
  "news-agent": ["agent_name", "overall_news_bias", "confidence", "uncertainties", "conflicting_reports", "warnings", "sources"],
  "macro-agent": ["agent_name", "macro_bias", "confidence", "uncertainties", "conflicts", "warnings", "sources"],
  "technical-agent": ["agent_name", "technical_bias", "confidence", "uncertainties", "technical_conflicts", "warnings", "sources"],
  "sentiment-agent": ["agent_name", "sentiment_bias", "confidence", "uncertainties", "conflicts", "warnings", "sources"],
  "trade-setup-agent": [
    "agent_name",
    "asset",
    "setup_status",
    "direction",
    "conflicting_evidence",
    "setup_quality",
    "confidence",
    "uncertainties",
    "warnings",
    "sources",
  ],
  "risk-manager": [
    "agent_name",
    "risk_level",
    "risk_decision",
    "risk_categories",
    "confidence",
    "uncertainties",
    "warnings",
    "sources",
  ],
});

function validateReport(report, expectedAgentName) {
  const requiredFields = REQUIRED_FIELDS[expectedAgentName];
  if (!requiredFields) {
    throw new Error(`Unknown expected agent_name: ${expectedAgentName}`);
  }

  if (!report || typeof report !== "object") {
    return { valid: false, errors: ["report must be an object"] };
  }
  if (report.agent_name !== expectedAgentName) {
    return { valid: false, errors: [`agent_name must be "${expectedAgentName}", got "${report.agent_name}"`] };
  }

  const errors = [];
  for (const field of requiredFields) {
    if (!(field in report)) errors.push(`Missing field: ${field}`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { REQUIRED_FIELDS, validateReport };
