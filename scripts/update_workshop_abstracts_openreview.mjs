import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materialsDir = path.join(root, "icml_2026_materials");
const workshopDir = path.join(materialsDir, "workshops");
const abstractsPath = path.join(materialsDir, "abstracts.jsonl");
const openreviewWeb = "https://openreview.net";
const openreviewApi = "https://api2.openreview.net/notes";

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row, Object.keys(row).sort())).join("\n")}\n`);
}

function contentValue(content, key) {
  const raw = content?.[key];
  if (raw && typeof raw === "object" && "value" in raw) return raw.value;
  return raw;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function abstractKeys(row) {
  const keys = [];
  if (row.paper_url) keys.push(String(row.paper_url));
  if (row.name) keys.push(`title:${String(row.name).trim().toLowerCase()}`);
  return keys;
}

function readWorkshopSubmissions() {
  const rows = [];
  for (const slug of fs.readdirSync(workshopDir).sort()) {
    const manifest = path.join(workshopDir, slug, "manifest.jsonl");
    if (!fs.existsSync(manifest)) continue;
    for (const row of readJsonl(manifest)) {
      if (row.source_type !== "openreview_submission") continue;
      if (row.status !== "accepted_public") continue;
      rows.push(row);
    }
  }
  rows.sort((left, right) => `${left.workshop_slug || ""}\t${left.title || ""}`.localeCompare(`${right.workshop_slug || ""}\t${right.title || ""}`));
  return rows;
}

function toAbstractEntry(source, abstract) {
  const id = String(source.openreview_id || "");
  return {
    abstract,
    event_type: "Workshop",
    id,
    name: source.title || "Untitled",
    paper_url: source.paper_url || `${openreviewWeb}/forum?id=${encodeURIComponent(id)}`,
    source: "openreview_browser_api",
    virtualsite_url: "",
    workshop_name: source.workshop_name || "",
    workshop_slug: source.workshop_slug || "",
  };
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const valueAfter = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  return {
    write: args.has("--write"),
    limit: Number(valueAfter("--limit", "0")) || 0,
    concurrency: Math.max(1, Math.min(12, Number(valueAfter("--concurrency", "5")) || 5)),
  };
}

const options = parseArgs();
const existingRows = readJsonl(abstractsPath);
const existingKeys = new Set(existingRows.flatMap(abstractKeys));
let submissions = readWorkshopSubmissions().filter((row) => {
  const paperUrl = row.paper_url || `${openreviewWeb}/forum?id=${encodeURIComponent(String(row.openreview_id || ""))}`;
  const titleKey = `title:${String(row.title || "").trim().toLowerCase()}`;
  return row.openreview_id && !existingKeys.has(paperUrl) && !existingKeys.has(titleKey);
});
if (options.limit) submissions = submissions.slice(0, options.limit);

const apiContext = await request.newContext({
  extraHTTPHeaders: {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    referer: openreviewWeb,
  },
});

const results = [];
let cursor = 0;
let completed = 0;

async function fetchOne(source) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const id = String(source.openreview_id || "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await apiContext.get(`${openreviewApi}?id=${encodeURIComponent(id)}`, { timeout: 20_000 });
      if (response.status() === 429) {
        await sleep(1200 * (attempt + 1) ** 2);
        continue;
      }
      if (!response.ok()) return { source, status: response.status(), abstract: "" };
      const payload = await response.json();
      const content = payload.notes?.[0]?.content || {};
      const value = contentValue(content, "abstract") || contentValue(content, "Abstract") || "";
      const abstract = Array.isArray(value) ? value.join(" ") : String(value || "");
      return {
        source: { ...source, paper_url: source.paper_url || `${openreviewWeb}/forum?id=${encodeURIComponent(id)}` },
        status: response.status(),
        abstract,
      };
    } catch {
      await sleep(900 * (attempt + 1));
    }
  }
  return { source, status: 0, abstract: "" };
}

async function worker() {
  while (cursor < submissions.length) {
    const source = submissions[cursor];
    cursor += 1;
    results.push(await fetchOne(source));
    completed += 1;
    if (completed % 25 === 0 || completed === submissions.length) {
      console.error(`openreview abstracts: ${completed}/${submissions.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
await apiContext.dispose();

const additions = [];
let missing = 0;
for (const result of results) {
  const abstract = cleanText(result.abstract);
  if (abstract.length >= 80) {
    additions.push(toAbstractEntry(result.source, abstract));
  } else {
    missing += 1;
  }
}

if (options.write && additions.length) {
  writeJsonl(abstractsPath, [...existingRows, ...additions]);
}

console.log(JSON.stringify({
  accepted_workshop_records_missing_before: submissions.length,
  fetched: results.length,
  new_abstracts: additions.length,
  missing,
  wrote: Boolean(options.write && additions.length),
  abstracts_path: abstractsPath,
}, null, 2));
