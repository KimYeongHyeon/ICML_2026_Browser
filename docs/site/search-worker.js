self.searchRecords = new Map();

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

self.addEventListener("message", (event) => {
  const { type, requestId, query, records, candidateIds } = event.data || {};
  if (type === "index") {
    self.searchRecords = new Map((records || []).map((record) => [record.id, {
      ...record,
      haystack: normalize(record.haystack),
      title: normalize(record.title),
    }]));
    self.postMessage({ type: "ready", count: self.searchRecords.size });
    return;
  }
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    self.postMessage({ requestId, query: normalizedQuery, ids: [], count: 0 });
    return;
  }
  const scored = [];
  const ids = candidateIds?.length ? candidateIds : [...self.searchRecords.keys()];
  for (const id of ids) {
    const record = self.searchRecords.get(id);
    if (!record) continue;
    const haystack = record.haystack;
    if (!haystack.includes(normalizedQuery)) continue;
    const titleMatch = record.title.includes(normalizedQuery);
    const score = (titleMatch ? 3 : 0) + Math.min(2, normalizedQuery.length / Math.max(1, haystack.length) * 120);
    scored.push({ id: record.id, score });
  }
  scored.sort((left, right) => right.score - left.score);
  self.postMessage({
    requestId,
    query: normalizedQuery,
    ids: scored.map((item) => item.id),
    count: scored.length,
  });
});
