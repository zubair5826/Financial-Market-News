// Support/resistance levels — built entirely from clustering
// structure.js's mechanical swing points, never invented. Each returned
// level cites its evidence (which swing points produced it) and a
// strength/confidence derived only from how many times price actually
// touched that zone — never a claim that price will reverse there.

const { findSwingPoints } = require("./structure");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { UNKNOWN } = require("../../core/constants");

function clusterPoints(points, tolerance) {
  const clusters = [];
  for (const point of points) {
    const cluster = clusters.find((c) => c.level !== 0 && Math.abs(c.level - point.value) / Math.abs(c.level) <= tolerance);
    if (cluster) {
      cluster.touches.push(point);
      cluster.level = cluster.touches.reduce((sum, p) => sum + p.value, 0) / cluster.touches.length;
    } else {
      clusters.push({ level: point.value, touches: [point] });
    }
  }
  return clusters;
}

function identifyLevels(candles, type, options = {}) {
  const lookback = typeof options.swingLookback === "number" ? options.swingLookback : 2;
  const tolerance = typeof options.levelClusterTolerance === "number" ? options.levelClusterTolerance : 0.015;
  const { highs, lows } = findSwingPoints(candles, lookback);
  const points = type === "RESISTANCE" ? highs : lows;

  if (points.length === 0) return [];

  const clusters = clusterPoints(points, tolerance);

  return clusters.map((c) => ({
    level: c.level,
    type,
    timeframe: options.timeframe || UNKNOWN,
    evidence: c.touches.map((t) => ({ index: t.index, value: t.value })),
    strength: c.touches.length >= 3 ? "STRONG" : c.touches.length === 2 ? "MODERATE" : "WEAK",
    confidence: c.touches.length >= 2 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
  }));
}

function identifySupportResistance(candles, options = {}) {
  return {
    support_levels: identifyLevels(candles, "SUPPORT", options),
    resistance_levels: identifyLevels(candles, "RESISTANCE", options),
  };
}

module.exports = { identifySupportResistance };
