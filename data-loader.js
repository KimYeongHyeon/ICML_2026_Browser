import {
  DATA_MANIFEST_URL,
} from "./config.js";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return response.json();
}

export async function loadIndexData() {
  const manifest = await fetchJson(DATA_MANIFEST_URL);
  const startup = await fetchJson(manifest.startupUrl);
  return {
    data: {
      generatedAt: startup.generatedAt || manifest.generatedAt,
      summary: startup.summary || manifest.summary || {},
      records: startup.records || [],
    },
    manifest,
    source: "shards",
  };
}

export async function loadShardRecords(manifest) {
  if (!manifest?.shards?.length) return null;
  const shards = await Promise.all(manifest.shards.map(async (shard) => fetchJson(shard.url)));
  return shards.flatMap((shard) => shard.records || []);
}
