import { buildPeopleAnalytics } from "./people-analytics.mjs";
import {
  attachResearchConcepts,
  parseConceptArtifact,
  researchConceptTags,
} from "./research-concepts.mjs";

export const PEOPLE_TOPICS_SCHEMA_VERSION = "icml-people-topics/v1";

function assertCompleteConceptArtifact(payload) {
  const summary = payload?.summary;
  const candidateCount = summary?.candidateRecordCount;
  const publishedCount = summary?.publishedRecordCount;
  const excludedCount = summary?.excludedRecordCount;
  if (
    payload?.schemaVersion !== "icml-concepts/v1"
    || !Number.isInteger(candidateCount)
    || candidateCount <= 0
    || publishedCount !== candidateCount
    || excludedCount !== 0
    || Object.keys(summary?.exclusionCounts || {}).length
  ) {
    throw new Error("A finalized artifact with complete concept coverage is required.");
  }
}

function recordsForScope(records, scope) {
  if (scope === "main") return records.filter((record) => record.type === "paper" || record.type === "poster");
  if (scope === "workshop") return records.filter((record) => record.type === "workshop");
  return records;
}

function normalizedWorkKey(record) {
  return String(record.title || "")
    .toLocaleLowerCase()
    .replace(/\\[a-z]+\b/giu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() || String(record.id || "");
}

function uniqueWorks(records) {
  const works = new Map();
  for (const record of records) {
    if (!record?.title) continue;
    const key = normalizedWorkKey(record);
    const previous = works.get(key);
    if (!previous || (previous.type === "poster" && record.type !== "poster")) works.set(key, record);
  }
  return [...works.values()];
}

function topicTrends(records) {
  const works = uniqueWorks(records);
  const counts = new Map();
  for (const record of works) {
    const label = researchConceptTags(record, "core")[0];
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const denominator = Math.max(1, works.length);
  const topics = [...counts.entries()]
    .map(([label, workCount]) => ({
      label,
      workCount,
      workShare: Number((workCount / denominator).toFixed(6)),
    }))
    .sort((left, right) => (right.workCount - left.workCount) || left.label.localeCompare(right.label));
  return {
    claimScope: "single-year-corpus-prevalence",
    note: "ICML 2026 is a single-year corpus. Counts describe prevalence, not temporal growth.",
    topics,
  };
}

function artifactAuthor(author) {
  return {
    identityId: author.identityId,
    name: author.name,
    aliases: author.aliases,
    identityEvidence: author.email
      ? "email"
      : author.paperCount > 1
        ? "normalized-name+shared-coauthor-context"
        : "single-record-name",
    paperCount: author.paperCount,
    topics: author.topics,
    recordIds: author.recordIds,
  };
}

function scopeArtifact(records) {
  const analytics = buildPeopleAnalytics(records);
  return {
    summary: analytics.summary,
    identityResolution: {
      method: "email-then-normalized-name-with-shared-coauthor-context",
      emailAddressesPublished: false,
    },
    authors: analytics.authors.map(artifactAuthor),
    coauthorLinks: analytics.coauthorLinks,
    groups: analytics.groups.map((group) => ({
      ...group,
      provenance: {
        kind: "coauthor-community-proxy",
        rule: "connected authors with a pair appearing on at least two unique works",
        verifiedAffiliation: false,
      },
    })),
    topicTrends: topicTrends(records),
  };
}

export function buildPeopleTopicsArtifact(records, conceptArtifact) {
  assertCompleteConceptArtifact(conceptArtifact);
  const concepts = parseConceptArtifact(conceptArtifact);
  const enriched = attachResearchConcepts(
    (records || []).map((record) => ({ ...record })),
    concepts,
  );
  return {
    schemaVersion: PEOPLE_TOPICS_SCHEMA_VERSION,
    source: {
      conceptArtifactFingerprint: conceptArtifact.fingerprints?.artifact || "",
      conceptRecordCount: conceptArtifact.summary.publishedRecordCount,
      corpusYear: 2026,
    },
    scopes: Object.fromEntries(["all", "main", "workshop"].map((scope) => [
      scope,
      scopeArtifact(recordsForScope(enriched, scope)),
    ])),
  };
}

export function parsePeopleTopicsArtifact(payload, expectedConceptFingerprint = "") {
  if (
    payload?.schemaVersion !== PEOPLE_TOPICS_SCHEMA_VERSION
    || !payload.source
    || !Number.isInteger(payload.source.conceptRecordCount)
    || payload.source.conceptRecordCount <= 0
    || !payload.scopes?.all
    || !payload.scopes?.main
    || !payload.scopes?.workshop
    || (expectedConceptFingerprint && payload.source.conceptArtifactFingerprint !== expectedConceptFingerprint)
  ) {
    throw new Error("Invalid people and topic analysis artifact.");
  }
  return payload;
}
