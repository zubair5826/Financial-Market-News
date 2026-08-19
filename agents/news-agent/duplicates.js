// Likely-duplicate detection. Reliably judging that two differently-
// worded headlines describe the same real-world event requires
// semantic/NLP understanding this system doesn't have — inventing that
// judgment from raw text would itself be a form of fabrication (falsely
// claiming two different stories are "the same event"). So the PRIMARY,
// deterministic signal here is structured metadata overlap: matching
// related_assets AND category. Headline token overlap is computed only
// as a secondary, reported similarity score for human/agent review, not
// as the deciding signal. This means duplicate-detection quality
// depends on related_assets/category actually being tagged on the
// input — documented as a limitation in README.md.
//
// Nothing is ever deleted or merged — grouped items are still returned
// intact in the caller's full item list; this only annotates groups.

const { UNKNOWN } = require("../../core/constants");

function tokenize(text) {
  if (!text || text === UNKNOWN) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardSimilarity(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function sharesAsset(a, b) {
  if (!Array.isArray(a.related_assets) || !Array.isArray(b.related_assets)) return false;
  return a.related_assets.some((asset) => b.related_assets.includes(asset));
}

function detectDuplicates(newsItems) {
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < newsItems.length; i++) {
    if (assigned.has(i)) continue;
    const group = [i];

    for (let j = i + 1; j < newsItems.length; j++) {
      if (assigned.has(j)) continue;
      const a = newsItems[i];
      const b = newsItems[j];

      const sameCategory = a.category !== UNKNOWN && a.category === b.category;
      const overlappingAsset = sharesAsset(a, b);

      if (sameCategory && overlappingAsset) {
        group.push(j);
      }
    }

    if (group.length > 1) {
      group.forEach((idx) => assigned.add(idx));
      const anchorTokens = tokenize(newsItems[group[0]].headline);
      groups.push({
        basis: "shared_related_assets_and_category",
        items: group.map((idx) => ({
          index: idx,
          headline: newsItems[idx].headline,
          source: newsItems[idx].source,
          text_similarity: idx === group[0] ? 1 : jaccardSimilarity(anchorTokens, tokenize(newsItems[idx].headline)),
        })),
      });
    }
  }

  return groups;
}

module.exports = { detectDuplicates, tokenize, jaccardSimilarity };
