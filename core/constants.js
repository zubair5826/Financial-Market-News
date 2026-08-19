// Shared sentinel values. Every contract in core/ uses these instead of
// null/undefined/"" so that "explicitly unavailable" is always
// distinguishable from "field not set" or a fabricated empty value.

const NOT_AVAILABLE = "NOT_AVAILABLE";
const UNKNOWN = "UNKNOWN";

module.exports = { NOT_AVAILABLE, UNKNOWN };
