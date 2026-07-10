const GENERIC_TERMS = new Set([
  "approach", "data", "framework", "learning", "method", "methods", "model", "models", "performance", "problem", "quality", "reasoning", "training",
]);

function displayTopic(value) {
  return String(value || "")
    .trim()
    .replace(/\bllms\b/iu, "LLMs")
    .replace(/\bmoe\b/iu, "MoE");
}

export function coreTopicTags(record, depth = "core") {
  const limit = depth === "detail" ? 3 : 1;
  const tags = (Array.isArray(record?.embeddingClusterKeywords) ? record.embeddingClusterKeywords : [])
    .map(displayTopic)
    .filter((value) => value && !GENERIC_TERMS.has(value.toLocaleLowerCase()));
  const unique = [...new Set(tags)];
  if (unique.length) return unique.slice(0, limit);
  const fallback = record?.embeddingClusterLabel || record?.clusterLabel;
  return (fallback ? [fallback] : record?.areaTags || []).filter(Boolean).slice(0, limit);
}
