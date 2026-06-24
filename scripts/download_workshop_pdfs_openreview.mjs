import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workshopRoot = path.join(root, "icml_2026_materials", "workshops");
const openreviewWeb = "https://openreview.net";
const openreviewApi = "https://api2.openreview.net/notes";
const minPdfBytes = 1024;

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function stableStringify(row) {
  const sorted = {};
  for (const key of Object.keys(row).sort()) sorted[key] = row[key];
  return JSON.stringify(sorted);
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map(stableStringify).join("\n")}\n`);
}

function slugify(value) {
  const slug = String(value || "paper").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "paper";
}

function parsePositiveInteger(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write") && !args.has("--dry-run");
  return {
    write,
    limit: parsePositiveInteger("--limit", 0),
    concurrency: Math.max(1, Math.min(8, parsePositiveInteger("--concurrency", 4))),
    retries: Math.max(1, Math.min(8, parsePositiveInteger("--retries", 4))),
    progressEvery: Math.max(1, parsePositiveInteger("--progress-every", 25)),
    baseDelayMs: Math.max(250, parsePositiveInteger("--base-delay-ms", 1200)),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(options, attempt) {
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(60000, options.baseDelayMs * (attempt + 1) ** 2 + jitter);
}

function isRetriableStatus(status) {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.join(" ");
  if (value && typeof value === "object" && "value" in value) return normalizeText(value.value);
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePdfUrl(value, openreviewId) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    return new URL(raw, openreviewWeb).toString();
  } catch {
    if (openreviewId) return `${openreviewWeb}/pdf?id=${encodeURIComponent(openreviewId)}`;
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function acceptedRowsNeedingPdf() {
  const items = [];
  for (const slug of fs.readdirSync(workshopRoot).sort()) {
    const manifestPath = path.join(workshopRoot, slug, "manifest.jsonl");
    if (!fs.existsSync(manifestPath)) continue;
    const rows = readJsonl(manifestPath);
    rows.forEach((row, index) => {
      if (row.source_type !== "openreview_submission") return;
      if (row.status !== "accepted_public") return;
      if (row.local_pdf_path && fs.existsSync(path.join(root, row.local_pdf_path))) return;
      if (!row.openreview_id) return;
      items.push({ manifestPath, rows, row, index });
    });
  }
  return items;
}

function targetPathFor(item) {
  const targetName = `${slugify(String(item.row.openreview_id))}-${slugify(item.row.title).slice(0, 80)}.pdf`;
  return path.join(path.dirname(item.manifestPath), "openreview_pdfs", targetName);
}

async function fetchNotePdfPath(context, openreviewId, options) {
  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    let response;
    try {
      response = await context.request.get(`${openreviewApi}?id=${encodeURIComponent(openreviewId)}`, {
        headers: { accept: "application/json" },
        timeout: 20000,
      });
    } catch (error) {
      if (attempt === options.retries - 1) {
        return { ok: false, status: 0, pdf: "", reason: `note_api_exception:${error.name || "unknown"}` };
      }
      await sleep(backoffMs(options, attempt));
      continue;
    }

    const status = response.status();
    if (!response.ok()) {
      const result = { ok: false, status, pdf: "", reason: `note_api_http_${status}` };
      if (!isRetriableStatus(status) || attempt === options.retries - 1) return result;
      await sleep(backoffMs(options, attempt));
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return { ok: false, status, pdf: "", reason: `note_api_json_exception:${error.name || "unknown"}` };
    }
    const note = payload.notes?.[0] || {};
    const content = note.content || {};
    const pdf = content.pdf?.value || content.pdf || "";
    const abstract = content.abstract?.value || content.Abstract?.value || content.abstract || content.Abstract || "";
    const result = { ok: true, status, pdf, abstract };
    if (result.ok || !isRetriableStatus(result.status) || attempt === options.retries - 1) return result;
    await sleep(backoffMs(options, attempt));
  }
  return { ok: false, status: 0, pdf: "", reason: "note_api_exhausted" };
}

async function discoverPdfFromForum(page, openreviewId, options) {
  const forumUrl = `${openreviewWeb}/forum?id=${encodeURIComponent(openreviewId)}`;
  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    try {
      const response = await page.goto(forumUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      const status = response?.status() || 0;
      if (status === 429 || status >= 500) {
        await sleep(backoffMs(options, attempt));
        continue;
      }

      const candidates = await page.evaluate(() => {
        const values = [];
        const add = (value) => {
          if (value && /\/pdf(?:\/|\?|$)/.test(value)) values.push(value);
        };
        for (const anchor of document.querySelectorAll("a[href]")) add(anchor.getAttribute("href"));
        for (const input of document.querySelectorAll("input[name*='pdf'], input[id*='pdf']")) add(input.getAttribute("value"));
        const html = document.documentElement.innerHTML;
        for (const match of html.matchAll(/"pdf"\s*:\s*(?:"([^"]+)"|\{\s*"value"\s*:\s*"([^"]+)")/g)) {
          add(match[1] || match[2]);
        }
        for (const match of html.matchAll(/https:\/\/openreview\.net\/pdf(?:\/[^"'\\<>\s]+|\?id=[^"'\\<>\s]+)/g)) {
          add(match[0]);
        }
        return [...new Set(values)];
      });
      return { status, candidates, reason: candidates.length ? "" : `forum_no_pdf_reference_http_${status}` };
    } catch (error) {
      if (attempt === options.retries - 1) {
        return { status: 0, candidates: [], reason: `forum_exception:${error.name || "unknown"}` };
      }
      await sleep(backoffMs(options, attempt));
    }
  }
  return { status: 0, candidates: [], reason: "forum_discovery_exhausted" };
}

async function fetchPdf(context, pdfUrl, options) {
  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    let response;
    try {
      response = await context.request.get(pdfUrl, {
        headers: {
          accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
          referer: openreviewWeb,
        },
        timeout: 45000,
      });
    } catch (error) {
      if (attempt === options.retries - 1) {
        return { ok: false, status: 0, bytes: 0, body: null, reason: `pdf_exception:${error.name || "unknown"}` };
      }
      await sleep(backoffMs(options, attempt));
      continue;
    }

    const status = response.status();
    if (!response.ok()) {
      if (isRetriableStatus(status) && attempt < options.retries - 1) {
        await sleep(backoffMs(options, attempt));
        continue;
      }
      return { ok: false, status, bytes: 0, body: null, reason: `pdf_http_${status}` };
    }

    const contentType = response.headers()["content-type"] || "";
    const body = await response.body();
    const startsWithPdf = body.subarray(0, 5).toString("latin1").startsWith("%PDF-");
    if (body.length < minPdfBytes) {
      return { ok: false, status, bytes: body.length, body: null, reason: `pdf_too_small_${body.length}` };
    }
    if (!contentType.toLowerCase().includes("pdf") && !startsWithPdf) {
      return { ok: false, status, bytes: body.length, body: null, reason: `pdf_not_pdf:${contentType || "unknown_content_type"}` };
    }
    return { ok: true, status, bytes: body.length, body, reason: "" };
  }
  return { ok: false, status: 0, bytes: 0, body: null, reason: "pdf_fetch_exhausted" };
}

function writePdf(targetPath, body) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, body);
  fs.renameSync(tempPath, targetPath);
}

async function acquirePdf(page, context, item, options) {
  const openreviewId = String(item.row.openreview_id || "");
  const note = await fetchNotePdfPath(context, openreviewId, options);
  const forum = await discoverPdfFromForum(page, openreviewId, options);
  const fallbackDirect = `${openreviewWeb}/pdf?id=${encodeURIComponent(openreviewId)}`;
  const candidates = unique([
    normalizePdfUrl(item.row.pdf_url, openreviewId),
    normalizePdfUrl(note.pdf, openreviewId),
    ...forum.candidates.map((candidate) => normalizePdfUrl(candidate, openreviewId)),
    fallbackDirect,
  ]);

  if (!candidates.length) {
    return {
      ok: false,
      pdfUrl: "",
      bytes: 0,
      reason: note.reason || forum.reason || "no_pdf_candidates",
    };
  }

  const failures = [];
  for (const pdfUrl of candidates) {
    const result = await fetchPdf(context, pdfUrl, options);
    if (result.ok) {
      const targetPath = targetPathFor(item);
      if (options.write) writePdf(targetPath, result.body);
      return {
        ok: true,
        pdfUrl,
        bytes: result.bytes,
        localPdfPath: path.relative(root, targetPath),
        reason: "",
      };
    }
    failures.push(`${pdfUrl} -> ${result.reason}`);
  }

  return {
    ok: false,
    pdfUrl: candidates[0],
    bytes: 0,
    reason: failures.join("; ") || note.reason || forum.reason || "pdf_validation_failed",
  };
}

const options = parseArgs();
let items = acceptedRowsNeedingPdf();
if (options.limit) items = items.slice(0, options.limit);

console.error(`workshop PDFs: starting needed=${items.length} concurrency=${options.concurrency} write=${options.write}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: {
    "accept-language": "en-US,en;q=0.9",
  },
});
const pages = await Promise.all(Array.from({ length: options.concurrency }, async () => {
  const page = await context.newPage();
  await page.goto(openreviewWeb, { waitUntil: "domcontentloaded", timeout: 45000 });
  return page;
}));

let cursor = 0;
let completed = 0;
let downloaded = 0;
let failed = 0;
let validatedBytes = 0;
const dirtyManifests = new Set();
const failureReasons = new Map();

async function worker(page) {
  while (cursor < items.length) {
    const item = items[cursor];
    cursor += 1;
    const result = await acquirePdf(page, context, item, options);
    const checkedAt = new Date().toISOString();

    if (result.ok) {
      item.row.pdf_url = result.pdfUrl;
      item.row.local_pdf_path = result.localPdfPath;
      item.row.failure_reason = null;
      item.row.source_checked_at = checkedAt;
      dirtyManifests.add(item.manifestPath);
      downloaded += 1;
      validatedBytes += result.bytes;
    } else {
      const reason = result.reason || "unknown_failure";
      item.row.failure_reason = reason;
      item.row.source_checked_at = checkedAt;
      dirtyManifests.add(item.manifestPath);
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
      failed += 1;
    }

    completed += 1;
    if (completed % options.progressEvery === 0 || completed === items.length) {
      console.error(`workshop PDFs: ${completed}/${items.length} ok=${downloaded} failed=${failed} validated_mb=${(validatedBytes / 1024 / 1024).toFixed(1)}`);
    }
  }
}

try {
  await Promise.all(pages.map((page) => worker(page)));
} finally {
  await browser.close();
}

if (options.write) {
  for (const manifestPath of dirtyManifests) {
    const item = items.find((candidate) => candidate.manifestPath === manifestPath);
    if (item) writeJsonl(manifestPath, item.rows);
  }
}

console.log(JSON.stringify({
  needed: items.length,
  downloaded,
  failed,
  validated_bytes: validatedBytes,
  manifests_changed: options.write ? dirtyManifests.size : 0,
  pending_manifest_changes: dirtyManifests.size,
  wrote: options.write,
  top_failure_reasons: [...failureReasons.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count })),
}, null, 2));
