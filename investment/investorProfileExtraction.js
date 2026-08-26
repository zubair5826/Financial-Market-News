// Investor Profile Extraction — implements the design frozen in Step
// 53/54. Deterministic, table/regex-based extraction ONLY: no LLM, no
// external NLP library, no network access, no ML/embeddings. Natural
// language text is normalized into a *candidate* InvestorProfile,
// built entirely through the existing, unmodified createInvestorProfile()
// (investorProfile.js) — this file never duplicates that schema, and
// never duplicates validateInvestorProfile()'s own rules. The returned
// profile must always be passed to validateInvestorProfile() by the
// caller; that function remains the sole authority on correctness.
//
// Governing principle (frozen Step 54): "If an incorrect inference
// could materially change portfolio construction, prefer UNKNOWN +
// clarification." UNKNOWN is therefore the default outcome for
// anything not cleanly, explicitly stated.
//
// INVESTMENT VEHICLE BOUNDARY (Step 54/55): Step 52's InvestorProfile
// schema has no investmentVehicle field, and this file must not modify
// that schema or corrupt assetClassRestrictions with vehicle-shaped
// data (e.g. "Only ETFs" is a statement about HOW exposure is held,
// not WHICH asset class). Since the extraction *output envelope*
// itself (as opposed to the `profile` sub-object) is being defined for
// the first time in this very file, a vehicle restriction is preserved
// in a new, additive, sibling key of the extraction result —
// `investmentVehicleRestrictions: {excluded, includedOnly}` — which
// sits alongside `profile`/`ambiguities`/`contradictions`, never inside
// `profile` itself. This is not a Step 52 contract change: the object
// passed to validateInvestorProfile() remains exactly Step-52-shaped.

const { createInvestorProfile } = require("./investorProfile");

// ---- Fixed deterministic vocabularies (Step 54, frozen) ----

const ASSET_CLASS_ALIASES = Object.freeze({
  stock: "EQUITIES",
  stocks: "EQUITIES",
  share: "EQUITIES",
  shares: "EQUITIES",
  equity: "EQUITIES",
  equities: "EQUITIES",
  bond: "BONDS",
  bonds: "BONDS",
  "fixed income": "BONDS",
  cash: "CASH",
  "cash equivalents": "CASH",
  commodity: "COMMODITIES",
  commodities: "COMMODITIES",
  gold: "GOLD",
  crypto: "CRYPTO",
  cryptos: "CRYPTO",
  cryptocurrency: "CRYPTO",
  cryptocurrencies: "CRYPTO",
  bitcoin: "CRYPTO",
  ethereum: "CRYPTO",
  forex: "FX",
  "foreign exchange": "FX",
  fx: "FX",
  "real estate": "ALTERNATIVES",
  "private equity": "ALTERNATIVES",
  alternatives: "ALTERNATIVES",
});

// "individual stocks/securities" is deliberately treated as an ASSET
// CLASS exclusion (EQUITIES), not a vehicle exclusion — an explicit,
// literal rule from Step 55, distinguishing it from "ETF" phrasing,
// which IS a vehicle concept.
const ASSET_CLASS_PHRASE_ALIASES = Object.freeze({
  "individual stock": "EQUITIES",
  "individual stocks": "EQUITIES",
  "individual security": "EQUITIES",
  "individual securities": "EQUITIES",
});

const VEHICLE_ALIASES = Object.freeze({
  etf: "ETF",
  etfs: "ETF",
  "mutual fund": "MUTUAL_FUND",
  "mutual funds": "MUTUAL_FUND",
});

const CURRENCY_PATTERNS = Object.freeze([
  { regex: /\bcad\b/i, code: "CAD" },
  { regex: /canadian dollars?/i, code: "CAD" },
  { regex: /\busd\b/i, code: "USD" },
  { regex: /us dollars?/i, code: "USD" },
  { regex: /american dollars?/i, code: "USD" },
  { regex: /\beur\b/i, code: "EUR" },
  { regex: /euros?/i, code: "EUR" },
  { regex: /\bgbp\b/i, code: "GBP" },
  { regex: /british pounds?/i, code: "GBP" },
  { regex: /pounds? sterling/i, code: "GBP" },
]);

const WORD_NUMBERS = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
});
const SCALE_WORDS = Object.freeze({ hundred: 100, thousand: 1000, million: 1000000 });

// Parses a bounded set of English number words (e.g. "three thousand",
// "twenty five") into a number. Returns null if the phrase isn't a
// recognizable number-word sequence — never a guess.
function parseWordNumber(phrase) {
  const tokens = phrase.toLowerCase().trim().split(/\s+|-/).filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let matchedAny = false;
  for (const token of tokens) {
    if (token in WORD_NUMBERS) {
      current += WORD_NUMBERS[token];
      matchedAny = true;
    } else if (token in SCALE_WORDS) {
      const scale = SCALE_WORDS[token];
      current = (current === 0 ? 1 : current) * scale;
      if (scale >= 1000) {
        total += current;
        current = 0;
      }
      matchedAny = true;
    } else {
      return null; // an unrecognized token makes the whole phrase unsafe to parse
    }
  }
  if (!matchedAny) return null;
  return total + current;
}

function parseNumericToken(raw) {
  const cleaned = raw.replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

// ---- Amount extraction ----

// A currency marker (prefix OR suffix) is REQUIRED for a number to
// count as a monetary amount candidate at all — Step 70 finding: a
// fully bare number (e.g. the "5" in "for 5 years") must never be
// treated as a competing investmentAmount candidate just because it
// happens to be a digit sequence somewhere else in the sentence.
const CURRENCY_SUFFIX_WORDS = "(?:(?:Canadian|US|American|British)\\s+)?(?:dollars?|euros?|pounds?)|CAD|USD|EUR|GBP";
const NUMERIC_AMOUNT_REGEX = new RegExp(
  `(-)?\\s*(?:(?:CAD|USD|EUR|GBP|US\\$|C\\$|\\$)\\s*(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(?:${CURRENCY_SUFFIX_WORDS}))?|(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${CURRENCY_SUFFIX_WORDS})\\b)`,
  "gi"
);
const WORD_AMOUNT_REGEX =
  /((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million))*)\s*dollars?/gi;
const APPROX_QUALIFIER_REGEX = /\b(about|roughly|around|approximately)\b/i;
const RANGE_REGEX = /between\s+(?:CAD|USD|EUR|GBP|US\$|C\$|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s+and\s+(?:CAD|USD|EUR|GBP|US\$|C\$|\$)?\s*(\d[\d,]*(?:\.\d+)?)/i;

function extractAmount(text) {
  const field = { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };
  const ambiguities = [];

  const rangeMatch = text.match(RANGE_REGEX);
  if (rangeMatch) {
    const a = parseNumericToken(rangeMatch[1]);
    const b = parseNumericToken(rangeMatch[2]);
    ambiguities.push({
      field: "investmentAmount",
      reason: "A range of amounts was stated; the extractor never averages or picks a bound.",
      candidates: [a, b].filter((v) => v !== null),
    });
    return { field, ambiguities };
  }

  const candidates = [];
  let match;
  NUMERIC_AMOUNT_REGEX.lastIndex = 0;
  while ((match = NUMERIC_AMOUNT_REGEX.exec(text)) !== null) {
    const magnitude = parseNumericToken(match[2] || match[3]);
    if (magnitude !== null) {
      const num = match[1] ? -magnitude : magnitude;
      candidates.push({ value: num, sourceText: match[0].trim(), index: match.index });
    }
  }
  WORD_AMOUNT_REGEX.lastIndex = 0;
  while ((match = WORD_AMOUNT_REGEX.exec(text)) !== null) {
    const num = parseWordNumber(match[1]);
    if (num !== null) candidates.push({ value: num, sourceText: match[0].trim(), index: match.index });
  }

  if (candidates.length === 0) return { field, ambiguities };

  candidates.sort((a, b) => a.index - b.index);
  const primary = candidates[0];
  const isApproximate = APPROX_QUALIFIER_REGEX.test(text.slice(Math.max(0, primary.index - 15), primary.index));

  if (primary.value <= 0) {
    return {
      field: { value: primary.value, provenance: "INVALID", reason: "A stated investment amount must be a positive number." },
      ambiguities,
    };
  }

  const primaryField = { value: primary.value, provenance: "PROVIDED", reason: isApproximate ? `Approximate amount stated: "${primary.sourceText}".` : `Amount stated: "${primary.sourceText}".` };

  if (candidates.length > 1) {
    ambiguities.push({
      field: "investmentAmount",
      reason: "Multiple distinct amounts were mentioned; only the first clearly-stated present amount was used as the primary value. The system does not sum unrelated amounts (e.g. a future contribution).",
      candidates: candidates.slice(1).map((c) => c.value),
    });
  }

  return { field: primaryField, ambiguities, primaryIndex: primary.index };
}

// Finds the clause (split the same way as extractEmergencyCash) that
// contains a given character index — used so the main investment
// amount's currency is read only from its own clause, never from an
// unrelated later clause (e.g. a separate emergency-cash statement
// with its own different currency).
function clauseContaining(text, index) {
  if (typeof index !== "number") return text;
  let offset = 0;
  for (const clause of text.split(CLAUSE_SPLIT_REGEX)) {
    const start = text.indexOf(clause, offset);
    const end = start + clause.length;
    if (index >= start && index <= end) return clause;
    offset = end;
  }
  return text;
}

// ---- Currency extraction ----

function extractCurrency(text) {
  const matches = new Set();
  for (const { regex, code } of CURRENCY_PATTERNS) {
    if (regex.test(text)) matches.add(code);
  }
  if (matches.size === 1) {
    const code = [...matches][0];
    return { field: { value: code, provenance: "PROVIDED", reason: `Currency explicitly stated as ${code}.` }, ambiguities: [] };
  }
  if (matches.size > 1) {
    return {
      field: { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" },
      ambiguities: [{ field: "investmentCurrency", reason: "More than one currency was mentioned; the extractor never guesses which applies.", candidates: [...matches] }],
    };
  }
  return { field: { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" }, ambiguities: [] };
}

// ---- Horizon extraction ----

const NUMERIC_HORIZON_REGEX =
  /\b(more than|over|at least)?\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*[\+]?\s*(months?|years?|yrs?)\b/i;

function unitToYears(value, unit) {
  return /month/i.test(unit) ? value / 12 : value;
}

function extractHorizon(text) {
  const contradictions = [];
  const lower = text.toLowerCase();

  const numericMatch = text.match(NUMERIC_HORIZON_REGEX);
  const hasOpenQualifier = numericMatch && numericMatch[1];
  const hasPlusSign = numericMatch && /\+/.test(numericMatch[0]);

  let numericYears = null;
  let sourceText = null;
  if (numericMatch) {
    const rawValue = numericMatch[2];
    const value = /^\d/.test(rawValue) ? parseNumericToken(rawValue) : parseWordNumber(rawValue);
    if (value !== null) {
      numericYears = unitToYears(value, numericMatch[3]);
      sourceText = numericMatch[0].trim();
    }
  }

  // "more than 10 years" / "10+ years": per the Step 54 frozen
  // resolution, open-ended phrasing at/above the LONG_TERM boundary is
  // represented via the qualitative band directly, never forced
  // through the numeric minimumYears path (which cannot express an
  // open upper bound at exactly 10 without a fabricated cutoff).
  if (numericYears !== null && (hasOpenQualifier || hasPlusSign) && numericYears >= 10) {
    return {
      field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "LONG_TERM", provenance: "PROVIDED", reason: `Open-ended long horizon stated: "${sourceText}".` },
      contradictions,
    };
  }

  if (numericYears !== null && !hasOpenQualifier && !hasPlusSign) {
    return {
      field: { minimumYears: numericYears, maximumYears: numericYears, band: "UNKNOWN", provenance: "PROVIDED", reason: `Horizon stated: "${sourceText}".` },
      contradictions,
    };
  }

  // Qualitative bands, explicitly stated.
  if (/\bshort[\s-]?term\b/.test(lower)) {
    return { field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "SHORT_TERM", provenance: "PROVIDED", reason: 'User explicitly said "short term".' }, contradictions };
  }
  if (/\bmedium[\s-]?term\b/.test(lower)) {
    return { field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "MEDIUM_TERM", provenance: "PROVIDED", reason: 'User explicitly said "medium term".' }, contradictions };
  }
  if (/\blong[\s-]?term\b/.test(lower)) {
    return { field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "LONG_TERM", provenance: "PROVIDED", reason: 'User explicitly said "long term".' }, contradictions };
  }

  // Narrow, safe inference: every plausible reading of "a few months"
  // falls within SHORT_TERM (<3 years) — a genuinely bounded phrase.
  if (/\ba few months\b/.test(lower)) {
    return {
      field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "SHORT_TERM", provenance: "INFERRED", reason: '"a few months" unambiguously falls within a short-term horizon under every plausible reading.' },
      contradictions,
    };
  }

  // "several years" can plausibly span SHORT_TERM through LONG_TERM —
  // never safely bucketed. Stays fully UNKNOWN.
  return { field: { minimumYears: "UNKNOWN", maximumYears: "UNKNOWN", band: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" }, contradictions };
}

// ---- Risk tolerance extraction ----

const RISK_CONTRADICTION_LOSS_REGEX = /\b(don't want to lose|do not want to lose|don't want any losses|do not want any losses)\b/i;
const RISK_CONTRADICTION_HIGHRISK_REGEX = /\bvery high returns\b.*\bhigh risk\b|\bhigh risk\b.*\bvery high returns\b/i;

const CONSERVATIVE_RISK_REGEX = /\b(i am conservative|i'm conservative|low risk|don't want much risk|do not want much risk|not much risk)\b/i;
const MODERATE_RISK_REGEX = /\b(moderate risk)\b/i;
const AGGRESSIVE_RISK_REGEX = /\b(i am aggressive|i'm aggressive|aggressive growth|comfortable taking high risk|comfortable with high risk|large temporary losses)\b/i;

function extractRiskTolerance(text) {
  const contradictions = [];

  if (RISK_CONTRADICTION_LOSS_REGEX.test(text) && RISK_CONTRADICTION_HIGHRISK_REGEX.test(text)) {
    contradictions.push({ fields: ["riskTolerance"], reason: "The user expressed both loss aversion and a desire for very high returns with high risk in the same statement — these cannot be safely reconciled into one risk category." });
    return { field: { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" }, contradictions };
  }

  if (CONSERVATIVE_RISK_REGEX.test(text)) {
    return { field: { value: "CONSERVATIVE", provenance: "PROVIDED", reason: "Direct statement of low risk tolerance." }, contradictions };
  }
  if (AGGRESSIVE_RISK_REGEX.test(text)) {
    return { field: { value: "AGGRESSIVE", provenance: "PROVIDED", reason: "Direct statement of high risk tolerance." }, contradictions };
  }
  if (MODERATE_RISK_REGEX.test(text)) {
    return { field: { value: "MODERATE", provenance: "PROVIDED", reason: "Direct statement of moderate risk tolerance." }, contradictions };
  }

  return { field: { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" }, contradictions };
}

// ---- Investment objective extraction ----

const OBJECTIVE_PATTERNS = Object.freeze([
  { regex: /\b(protect my money|preserve capital|preserve my capital|don't lose my principal|do not lose my principal|don't want to lose my money|do not want to lose my money)\b/i, value: "CAPITAL_PRESERVATION" },
  { regex: /\b(generate income|regular income|earn income)\b/i, value: "INCOME" },
  { regex: /\bbalanced growth\b/i, value: "BALANCED_GROWTH" },
  { regex: /\b(grow my money|my money to grow|long[\s-]?term growth|capital growth)\b/i, value: "CAPITAL_GROWTH" },
  { regex: /\b(speculate|speculative investment)\b/i, value: "SPECULATION" },
]);

function extractObjective(text, riskField, horizonField) {
  for (const { regex, value } of OBJECTIVE_PATTERNS) {
    if (regex.test(text)) {
      return { value, provenance: "PROVIDED", reason: `Direct objective statement matched for ${value}.` };
    }
  }

  // Narrow, safe inference (Step 54): only when every plausible
  // interpretation of the stated risk tolerance + horizon band agrees
  // on one objective.
  if (riskField.provenance === "PROVIDED" && riskField.value === "CONSERVATIVE" && horizonField.band === "SHORT_TERM" && (horizonField.provenance === "PROVIDED" || horizonField.provenance === "INFERRED")) {
    return {
      value: "CAPITAL_PRESERVATION",
      provenance: "INFERRED",
      reason: "Inferred from an explicitly stated conservative risk tolerance combined with a short-term horizon — every plausible reading of this combination points to capital preservation.",
    };
  }

  return { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };
}

// ---- Liquidity extraction ----

function extractLiquidity(text) {
  if (/\b(need the money immediately|need it immediately|may need the money immediately)\b/i.test(text)) {
    return { value: "IMMEDIATE", provenance: "PROVIDED", reason: "Direct statement of an immediate liquidity need." };
  }
  if (/\b(need access within a few months|may need it soon|need it soon)\b/i.test(text)) {
    return { value: "SHORT_TERM", provenance: "PROVIDED", reason: "Direct statement of a near-term liquidity need." };
  }
  if (/\b(don't need the money soon|do not need the money soon|can leave it invested|don't need it soon|do not need it soon)\b/i.test(text)) {
    return { value: "FLEXIBLE", provenance: "PROVIDED", reason: "Direct statement that the funds can remain invested." };
  }
  return { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };
}

// ---- Emergency cash extraction ----

// Splits on sentence punctuation AND the conjunction " and " so a
// clause like "...and need USD $2,000 for emergencies" is isolated
// from an earlier clause in the same sentence that may carry a
// different, unrelated currency (e.g. the main investment amount).
// Deliberately does NOT split on a bare comma — a comma is a
// legitimate thousands separator inside an amount (e.g. "$2,000") and
// splitting on it would corrupt the very number being extracted.
const CLAUSE_SPLIT_REGEX = /[.;]| and /i;
const EMERGENCY_AMOUNT_REGEX = /(?:CAD|USD|EUR|GBP|US\$|C\$|\$)?\s*(\d[\d,]*(?:\.\d+)?)/;

function extractEmergencyCash(text) {
  const clauses = text.split(CLAUSE_SPLIT_REGEX);
  const clause = clauses.find((c) => /emergenc/i.test(c));
  if (!clause) return { value: "UNKNOWN", currency: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };
  const amountMatch = clause.match(EMERGENCY_AMOUNT_REGEX);
  if (!amountMatch) return { value: "UNKNOWN", currency: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };

  const amount = parseNumericToken(amountMatch[1]);
  if (amount === null || amount <= 0) return { value: "UNKNOWN", currency: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" };

  // Currency is only ever read from within the emergency-cash clause
  // itself — never inherited from the main investment amount stated
  // elsewhere in the message (Step 53/54 frozen decision).
  const { field: currencyField } = extractCurrency(clause);

  return {
    value: amount,
    currency: currencyField.value,
    provenance: "PROVIDED",
    reason: `Explicit emergency-cash statement: "${clause.trim()}".`,
  };
}

// ---- Asset-class / investment-vehicle restriction extraction ----

const PERCENT_REGEX = /(\d+(?:\.\d+)?)\s*%/;

function findCanonicalAssetClass(phrase) {
  const key = phrase.toLowerCase().trim();
  if (key in ASSET_CLASS_PHRASE_ALIASES) return ASSET_CLASS_PHRASE_ALIASES[key];
  if (key in ASSET_CLASS_ALIASES) return ASSET_CLASS_ALIASES[key];
  return null;
}

function findCanonicalVehicle(phrase) {
  const key = phrase.toLowerCase().trim();
  return key in VEHICLE_ALIASES ? VEHICLE_ALIASES[key] : null;
}

const ASSET_TERM_ALTERNATION = [...Object.keys(ASSET_CLASS_PHRASE_ALIASES), ...Object.keys(ASSET_CLASS_ALIASES)]
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const VEHICLE_TERM_ALTERNATION = Object.keys(VEHICLE_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join("|");

function extractRestrictions(text) {
  const excluded = new Set();
  const includedOnly = new Set();
  const maximumByClass = {};
  const vehicleExcluded = new Set();
  const vehicleIncludedOnly = new Set();
  const contradictions = [];
  const ambiguities = [];

  const excludeRegex = new RegExp(`\\b(no|not invest in|avoid|do not invest in|don't invest in|exclude)\\s+(${ASSET_TERM_ALTERNATION})\\b`, "gi");
  let match;
  while ((match = excludeRegex.exec(text)) !== null) {
    const cls = findCanonicalAssetClass(match[2]);
    if (cls) excluded.add(cls);
  }

  const onlyClassRegex = new RegExp(`\\bonly\\s+(${ASSET_TERM_ALTERNATION})\\b`, "gi");
  while ((match = onlyClassRegex.exec(text)) !== null) {
    const cls = findCanonicalAssetClass(match[1]);
    if (cls) includedOnly.add(cls);
  }

  const onlyVehicleRegex = new RegExp(`\\bonly\\s+(${VEHICLE_TERM_ALTERNATION})\\b`, "gi");
  while ((match = onlyVehicleRegex.exec(text)) !== null) {
    const vehicle = findCanonicalVehicle(match[1]);
    if (vehicle) vehicleIncludedOnly.add(vehicle);
  }
  const noVehicleRegex = new RegExp(`\\b(no|avoid)\\s+(${VEHICLE_TERM_ALTERNATION})\\b`, "gi");
  while ((match = noVehicleRegex.exec(text)) !== null) {
    const vehicle = findCanonicalVehicle(match[2]);
    if (vehicle) vehicleExcluded.add(vehicle);
  }

  const maxByClassRegex = new RegExp(`\\b(?:keep\\s+)?(${ASSET_TERM_ALTERNATION})\\s+(?:below|under|to no more than|to at most)\\s+(\\d+(?:\\.\\d+)?)\\s*%`, "gi");
  while ((match = maxByClassRegex.exec(text)) !== null) {
    const cls = findCanonicalAssetClass(match[1]);
    const pct = Number(match[2]);
    if (cls && pct > 0 && pct <= 100) maximumByClass[cls] = pct / 100;
  }

  // Structural contradiction: the same asset class explicitly both
  // excluded and included-only — these cannot both be true, and
  // neither side is discarded. (An exclusion combined with a maximum
  // allocation percentage for the SAME class is NOT flagged here: a
  // 0% actual allocation always satisfies any non-negative cap, so
  // "no crypto" + "keep crypto below 5%" are simultaneously
  // satisfiable, not a genuine contradiction — Step 60 review finding.)
  for (const cls of excluded) {
    if (includedOnly.has(cls)) {
      contradictions.push({ fields: ["assetClassRestrictions"], reason: `"${cls}" was both excluded and listed as an included-only class.` });
    }
  }

  // Lexical contradiction: an "only <vehicle>" restriction stated
  // alongside an explicit desire for a different, incompatible
  // vehicle/asset (e.g. "Only ETFs, but I also want individual
  // stocks/Bitcoin").
  if (vehicleIncludedOnly.has("ETF")) {
    if (/\bindividual stocks?\b/i.test(text) && /\bwant\b/i.test(text)) {
      contradictions.push({ fields: ["investmentVehicleRestrictions"], reason: 'An ETF-only restriction was stated alongside an expressed desire for individual stocks.' });
    }
    if (/\bwant\b.*\bbitcoin\b|\bbitcoin\b.*\bwant\b/i.test(text)) {
      contradictions.push({ fields: ["investmentVehicleRestrictions"], reason: 'An ETF-only restriction was stated alongside an expressed desire for Bitcoin.' });
    }
  }

  return {
    assetClassRestrictions: { excluded: [...excluded], includedOnly: [...includedOnly], maximumByClass },
    investmentVehicleRestrictions: { excluded: [...vehicleExcluded], includedOnly: [...vehicleIncludedOnly] },
    contradictions,
    ambiguities,
  };
}

// ---- Maximum concentration extraction ----

const PORTFOLIO_WIDE_CONCENTRATION_REGEX =
  /\b(?:never put|don't put|do not put)\s+more than\s+(\d+(?:\.\d+)?)\s*%\s+(?:in|into)\s+(?:one|any one|a single)\s+(?:position|asset)\b/i;
const CLASS_LEVEL_CONCENTRATION_REGEX =
  /\b(?:no more than|not more than|don't want more than|do not want more than)\s+(?:half|\d+(?:\.\d+)?\s*%)\b[^.]*\b(?:one|a single)\s+asset class\b/i;

function extractMaximumConcentration(text) {
  const ambiguities = [];
  const portfolioMatch = text.match(PORTFOLIO_WIDE_CONCENTRATION_REGEX);
  if (portfolioMatch) {
    const pct = Number(portfolioMatch[1]);
    if (pct > 0 && pct <= 100) {
      return { field: { value: pct / 100, provenance: "PROVIDED", reason: `Portfolio-wide single-position cap stated: "${portfolioMatch[0].trim()}".` }, ambiguities };
    }
  }

  if (CLASS_LEVEL_CONCENTRATION_REGEX.test(text)) {
    ambiguities.push({
      field: "maximumConcentration",
      reason: "An unnamed per-asset-class concentration limit was stated; the current contract only supports a portfolio-wide limit or a NAMED asset-class limit, not an unnamed uniform per-class cap.",
      candidates: [],
    });
  }

  return { field: { value: "UNKNOWN", provenance: "UNKNOWN", reason: "UNKNOWN" }, ambiguities };
}

// ---- Main entry point ----

// text: must be a string. Any other input (undefined, null, object,
// array, number, empty string) is rejected safely — never thrown —
// and produces a fully-UNKNOWN candidate profile with no ambiguities
// or contradictions.
function extractInvestorProfile(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return {
      profile: createInvestorProfile({}),
      ambiguities: [],
      contradictions: [],
      investmentVehicleRestrictions: { excluded: [], includedOnly: [] },
    };
  }

  const ambiguities = [];
  const contradictions = [];

  const amountResult = extractAmount(text);
  ambiguities.push(...amountResult.ambiguities);

  // Currency is read from the same clause as the primary amount only
  // — never from an unrelated later clause (e.g. a separate
  // emergency-cash statement carrying its own different currency).
  const currencyScopeText = clauseContaining(text, amountResult.primaryIndex);
  const currencyResult = extractCurrency(currencyScopeText);
  ambiguities.push(...currencyResult.ambiguities);

  const horizonResult = extractHorizon(text);
  contradictions.push(...horizonResult.contradictions);

  const riskResult = extractRiskTolerance(text);
  contradictions.push(...riskResult.contradictions);

  const objectiveField = extractObjective(text, riskResult.field, horizonResult.field);

  const liquidityField = extractLiquidity(text);
  const emergencyCashField = extractEmergencyCash(text);

  const restrictionsResult = extractRestrictions(text);
  contradictions.push(...restrictionsResult.contradictions);
  ambiguities.push(...restrictionsResult.ambiguities);

  const concentrationResult = extractMaximumConcentration(text);
  ambiguities.push(...concentrationResult.ambiguities);

  const profile = createInvestorProfile({
    investmentAmount: amountResult.field,
    investmentCurrency: currencyResult.field,
    investmentHorizon: horizonResult.field,
    riskTolerance: riskResult.field,
    investmentObjective: objectiveField,
    liquidityRequirement: liquidityField,
    emergencyCashRequirement: emergencyCashField,
    assetClassRestrictions: restrictionsResult.assetClassRestrictions,
    maximumConcentration: concentrationResult.field,
  });

  return {
    profile,
    ambiguities,
    contradictions,
    investmentVehicleRestrictions: restrictionsResult.investmentVehicleRestrictions,
  };
}

module.exports = { extractInvestorProfile };
