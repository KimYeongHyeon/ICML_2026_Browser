import {
  DATA_MANIFEST_URL,
  PEOPLE_TOPICS_URL,
  RESEARCH_CONCEPTS_URL,
} from "./config.js";
import { parsePeopleTopicsArtifact } from "./people-artifact.mjs";
import { parseConceptArtifact } from "./research-concepts.mjs";

const RESEARCH_CONCEPT_ARTIFACT_SCHEMA = "icml-concepts/v1";

export function versionedUrl(url, version) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return response.json();
}

export async function loadIndexData() {
  const manifest = await fetchJson(DATA_MANIFEST_URL, { cache: "no-store" });
  const version = manifest.generatedAt || "";
  const startup = await fetchJson(versionedUrl(manifest.startupUrl, version), { cache: "reload" });
  return {
    data: {
      generatedAt: startup.generatedAt || manifest.generatedAt,
      summary: startup.summary || manifest.summary || {},
      records: startup.records || [],
    },
    manifest: { ...manifest, version },
    source: "shards",
  };
}

export async function loadShardRecords(manifest) {
  if (!manifest?.shards?.length) return null;
  const version = manifest.generatedAt || manifest.version || "";
  const shards = await Promise.all(manifest.shards.map(async (shard) => fetchJson(versionedUrl(shard.url, version), { cache: "reload" })));
  return shards.flatMap((shard) => shard.records || []);
}

export async function loadResearchConcepts(version) {
  const payload = await fetchJson(versionedUrl(RESEARCH_CONCEPTS_URL, version), { cache: "reload" });
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || payload.schemaVersion !== RESEARCH_CONCEPT_ARTIFACT_SCHEMA
    || !payload.records
    || typeof payload.records !== "object"
    || Array.isArray(payload.records)
    || !payload.summary
    || typeof payload.summary !== "object"
    || Array.isArray(payload.summary)
    || !Number.isInteger(payload.summary.publishedRecordCount)
    || payload.summary.publishedRecordCount < 0
    || !/^sha256:[0-9a-f]{64}$/u.test(payload.fingerprints?.artifact || "")
  ) {
    throw new Error("Invalid research concepts artifact.");
  }
  const concepts = parseConceptArtifact(payload);
  if (concepts.size !== payload.summary.publishedRecordCount) {
    throw new Error("Invalid research concepts artifact.");
  }
  concepts.artifactFingerprint = String(payload.fingerprints?.artifact || "");
  concepts.artifactRecordCount = payload.summary.publishedRecordCount;
  return concepts;
}

export async function loadPeopleTopics(
  version,
  conceptFingerprint = "",
  indexArtifactFingerprint = "",
  conceptRecordCount = 0,
) {
  const payload = await fetchJson(versionedUrl(PEOPLE_TOPICS_URL, version), { cache: "reload" });
  return parsePeopleTopicsArtifact(
    payload,
    conceptFingerprint,
    version,
    indexArtifactFingerprint,
    conceptRecordCount,
  );
}
