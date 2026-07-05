import {
  DATA_MANIFEST_URL,
} from "./config.js";

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
