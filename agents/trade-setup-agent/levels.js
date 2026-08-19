// Potential price levels and invalidation conditions — built ONLY from
// the Technical Agent's already-validated support_levels/
// resistance_levels (Step 7). No number here is ever invented, offset,
// or estimated by this agent.
//
//   OBSERVED_LEVEL: every support/resistance level exactly as the
//     Technical Agent computed it, relabeled with its role.
//   PROPOSED_SETUP_LEVEL: the subset of OBSERVED_LEVELs relevant to
//     the current direction (BULLISH -> SUPPORT levels, BEARISH ->
//     RESISTANCE levels) — the SAME level object, not a new number.
//     "Proposed" means "worth referencing for a setup," never a
//     fabricated entry/stop price.
//
// Invalidation conditions are qualitative (CLOSE_BELOW_LEVEL /
// CLOSE_ABOVE_LEVEL against a real observed level) — never a price
// with an invented buffer/offset added.

function deriveLevels(technicalReport, direction) {
  if (!technicalReport) {
    return { potential_levels: [], observed: [], proposed: [], dataAvailable: false };
  }

  const observed = [
    ...(technicalReport.support_levels || []).map((l) => ({ ...l, level_type: "OBSERVED_LEVEL", role: "SUPPORT" })),
    ...(technicalReport.resistance_levels || []).map((l) => ({ ...l, level_type: "OBSERVED_LEVEL", role: "RESISTANCE" })),
  ];

  const relevantRole = direction === "BULLISH" ? "SUPPORT" : direction === "BEARISH" ? "RESISTANCE" : null;
  const proposed = relevantRole
    ? observed
        .filter((l) => l.role === relevantRole)
        .map((l) => ({
          ...l,
          level_type: "PROPOSED_SETUP_LEVEL",
          note: "Derived directly from an OBSERVED_LEVEL — no price invented or offset.",
        }))
    : [];

  return { potential_levels: [...observed, ...proposed], observed, proposed, dataAvailable: true };
}

function deriveInvalidationConditions(levels, direction) {
  if (!levels.dataAvailable) {
    return [{ condition: "DATA_UNAVAILABLE", reason: "No technical report supplied — no validated levels to derive invalidation from." }];
  }
  if (levels.proposed.length === 0) {
    return [
      {
        condition: "DATA_UNAVAILABLE",
        reason: "No relevant validated support/resistance levels available for this direction.",
      },
    ];
  }

  return levels.proposed.map((l) => ({
    condition: direction === "BULLISH" ? "CLOSE_BELOW_LEVEL" : "CLOSE_ABOVE_LEVEL",
    level: l.level,
    level_type: l.level_type,
    timeframe: l.timeframe,
    reason: `Potential invalidation if price closes ${direction === "BULLISH" ? "below" : "above"} the observed ${l.role.toLowerCase()} level.`,
  }));
}

module.exports = { deriveLevels, deriveInvalidationConditions };
