import { chromium } from "playwright";

const rawBaseUrl = process.argv[2] || "http://127.0.0.1:57995/";
const url = new URL(rawBaseUrl);
url.searchParams.set("verify", "1");
const baseUrl = url.toString();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

const consoleErrors = [];
const failedRequests = [];
const badResponses = [];

function isSameOrigin(url) {
  return url.startsWith(baseUrl) || url.startsWith(new URL(baseUrl).origin);
}

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("requestfailed", (request) => {
  if (isSameOrigin(request.url())) {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.trim());
  }
});
page.on("response", (response) => {
  if (response.status() >= 400 && isSameOrigin(response.url())) {
    badResponses.push(`${response.status()} ${response.url()}`);
  }
});

async function scanGraphTooltip(scopeSelector, points) {
  const box = await page.locator(scopeSelector).boundingBox();
  if (!box) return "";
  for (const [px, py] of points) {
    await page.mouse.move(box.x + box.width * px, box.y + box.height * py);
    await page.waitForTimeout(80);
    const text = await page.evaluate((selector) => {
      const scope = document.querySelector(selector);
      const tooltip = scope ? [...scope.querySelectorAll(":scope > .graph-node-tooltip")].find((item) => !item.hidden) : null;
      return tooltip?.textContent || "";
    }, scopeSelector);
    if (text) return text;
  }
  return "";
}

async function scanGraphTooltipAtPoints(scopeSelector, points) {
  const box = await page.locator(scopeSelector).boundingBox();
  if (!box) return "";
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x > box.width || point.y > box.height) continue;
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.waitForTimeout(80);
    const text = await page.evaluate((selector) => {
      const scope = document.querySelector(selector);
      const tooltip = scope ? [...scope.querySelectorAll(":scope > .graph-node-tooltip")].find((item) => !item.hidden) : null;
      return tooltip?.textContent || "";
    }, scopeSelector);
    if (text) return text;
  }
  return "";
}

const centerGrid = [];
for (const px of [0.30, 0.38, 0.46, 0.50, 0.54, 0.62, 0.70]) {
  for (const py of [0.28, 0.36, 0.44, 0.50, 0.56, 0.64, 0.72]) {
    centerGrid.push([px, py]);
  }
}

const broadGrid = [];
for (const px of [0.14, 0.26, 0.38, 0.50, 0.62, 0.74, 0.86]) {
  for (const py of [0.18, 0.30, 0.42, 0.54, 0.66, 0.78]) {
    broadGrid.push([px, py]);
  }
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForSelector(".result-item", { timeout: 30000 });

const initial = await page.evaluate(() => ({
  note: document.querySelector(".data-note")?.innerText || "",
  paperHidden: document.querySelector('.tab[data-tab="paper"]')?.hidden || false,
  resultCount: document.querySelector("#resultCount")?.innerText || "",
}));

await page.locator('.tab[data-tab="paper"]').click();
await page.waitForTimeout(300);

const paper = await page.evaluate(() => ({
  resultCount: document.querySelector("#resultCount")?.innerText || "",
}));

await page.locator("#searchInput").fill("spotlight");
await page.waitForTimeout(300);
const paperSpotlight = await page.evaluate(() => ({
  resultCount: document.querySelector("#resultCount")?.innerText || "",
  hasSpotlightBadge: Boolean([...document.querySelectorAll(".result-item .badge.spotlight")].length),
}));

await page.locator("#searchInput").fill("Hierarchical Multi-Agent");
await page.waitForTimeout(300);
await page.locator(".result-item").first().click();
await page.waitForTimeout(100);
const paperLatex = await page.evaluate(() => ({
  resultTitle: document.querySelector(".result-item .result-title")?.innerText || "",
  viewerKind: document.querySelector("#viewerKind")?.innerText || "",
  viewerTitle: document.querySelector("#viewerTitle")?.innerText || "",
  viewerMeta: document.querySelector("#viewerMeta")?.innerText || "",
}));
await page.waitForSelector(".mini-graph canvas", { timeout: 30000 });
await page.evaluate(() => document.querySelector(".mini-graph")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(900);
const miniTooltip = await scanGraphTooltip(".mini-graph", centerGrid);

await page.locator("#searchInput").fill("zzzz-no-records");
await page.waitForTimeout(100);
await page.locator('.tab[data-tab="workshop"]').click();
await page.waitForTimeout(300);

const afterSwitch = await page.evaluate(() => {
  const filters = document.querySelector(".filters");
  return {
    searchValue: document.querySelector("#searchInput")?.value || "",
    resultCount: document.querySelector("#resultCount")?.innerText || "",
    activeSummary: document.querySelector("#activeSummary")?.innerText || "",
    viewportWidth: innerWidth,
    bodyScrollWidth: document.documentElement.scrollWidth,
    filtersClientWidth: filters.clientWidth,
    filtersScrollWidth: filters.scrollWidth,
    overflow: filters.scrollWidth > filters.clientWidth || document.documentElement.scrollWidth > innerWidth,
  };
});

await page.locator('.tab[data-tab="map"]').click();
await page.waitForSelector("#mapCanvas canvas", { timeout: 30000 });
await page.waitForTimeout(500);
const mapBox = await page.locator("#mapCanvas").boundingBox();
const forceZoomBeforeWheel = await page.evaluate(() => window.__icmlMapDebug?.forceZoom?.() || null);
if (mapBox) {
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.wheel(0, -320);
}
await page.waitForTimeout(120);
const forceZoomAfterWheel = await page.evaluate(() => window.__icmlMapDebug?.forceZoom?.() || null);
if (mapBox) {
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2, { button: "middle" });
}
await page.waitForTimeout(200);
const forceProbePoints = await page.evaluate(() => window.__icmlMapDebug?.forceProbePoints?.(120) || []);
const mapTooltip = await scanGraphTooltipAtPoints("#mapCanvas", forceProbePoints) || await scanGraphTooltip("#mapCanvas", broadGrid);

await page.locator("#mapEngineSelect").selectOption("cytoscape");
await page.waitForTimeout(1400);
const cytoscapeProbePoints = await page.evaluate(() => window.__icmlMapDebug?.cytoscapeProbePoints?.(120) || []);
const cytoscapeTooltip = await scanGraphTooltipAtPoints("#mapCanvas", cytoscapeProbePoints) || await scanGraphTooltip("#mapCanvas", broadGrid);

const map = await page.evaluate(() => ({
  activeSummary: document.querySelector("#activeSummary")?.innerText || "",
  hasCanvas: Boolean(document.querySelector("#mapCanvas canvas")),
  colorLabels: [...document.querySelectorAll("#mapColorSelect option")].map((option) => option.textContent || ""),
  colorValue: document.querySelector("#mapColorSelect")?.value || "",
  legendNote: document.querySelector(".legend-note")?.innerText || "",
  tooltipCount: document.querySelectorAll(".graph-node-tooltip").length,
}));
map.forceZoomBeforeWheel = forceZoomBeforeWheel;
map.forceZoomAfterWheel = forceZoomAfterWheel;

const report = {
  baseUrl,
  initial,
  paper,
  paperSpotlight,
  paperLatex,
  miniTooltip,
  afterSwitch,
  map,
  mapTooltip,
  cytoscapeTooltip,
  consoleErrors,
  failedRequests,
  badResponses,
};

console.log(JSON.stringify(report, null, 2));

if (!initial.note.includes("Unofficial public beta") || !initial.note.includes("accepted main-conference metadata")) {
  throw new Error("missing beta/data limitation note");
}
if (initial.paperHidden) {
  throw new Error("Paper tab should be visible for accepted main-conference metadata");
}
if (!/^6,343 results/.test(initial.resultCount)) {
  throw new Error(`unexpected initial poster count: ${initial.resultCount}`);
}
if (!/^6,343 results/.test(paper.resultCount)) {
  throw new Error(`unexpected paper count: ${paper.resultCount}`);
}
if (!paperSpotlight.hasSpotlightBadge || /^0 results/.test(paperSpotlight.resultCount)) {
  throw new Error(`Paper tab should expose searchable Spotlight badges: ${JSON.stringify(paperSpotlight)}`);
}
if (paperLatex.viewerKind.includes("Paper · Poster") || paperLatex.viewerMeta.split("\n").includes("Poster")) {
  throw new Error(`regular poster presentation leaked into paper identity: ${JSON.stringify(paperLatex)}`);
}
if (/texttt|\\texttt|\{Multi\}/.test(`${paperLatex.resultTitle} ${paperLatex.viewerTitle}`)) {
  throw new Error(`raw LaTeX command leaked into paper title: ${JSON.stringify(paperLatex)}`);
}
if (!miniTooltip.includes("Area:") || !miniTooltip.includes("Domain:")) {
  throw new Error(`mini semantic graph tooltip did not expose title and area/domain decoder: ${miniTooltip}`);
}
if (afterSwitch.searchValue !== "") {
  throw new Error("search input did not reset after switching tabs");
}
if (!/^723 results/.test(afterSwitch.resultCount)) {
  throw new Error(`unexpected workshop count after tab switch: ${afterSwitch.resultCount}`);
}
if (afterSwitch.overflow) {
  throw new Error("filter grid or document overflows at 1366px");
}
if (!map.hasCanvas || !map.activeSummary.includes("Map")) {
  throw new Error(`map smoke failed: ${JSON.stringify(map)}`);
}
if (!map.colorLabels.includes("Area + Domain") || !map.colorLabels.includes("Research area") || !map.colorLabels.includes("Embedding cluster")) {
  throw new Error(`map color labels should distinguish area vs cluster: ${JSON.stringify(map)}`);
}
if (!map.activeSummary.includes("global") || !map.activeSummary.includes("area + domain")) {
  throw new Error(`map summary should include both scope and color mode: ${JSON.stringify(map)}`);
}
if (map.colorValue !== "area-domain" || !map.legendNote.includes("Fill = research area") || !map.legendNote.includes("Ring = domain")) {
  throw new Error(`area/domain mode should be the default and explain fill/ring semantics: ${JSON.stringify(map)}`);
}
if (!mapTooltip.includes("Area:") || !mapTooltip.includes("Domain:")) {
  throw new Error(`main ForceGraph tooltip did not expose title and area/domain decoder: ${mapTooltip}`);
}
if (!Number.isFinite(map.forceZoomBeforeWheel) || !Number.isFinite(map.forceZoomAfterWheel) || map.forceZoomAfterWheel <= map.forceZoomBeforeWheel) {
  throw new Error(`ForceGraph wheel zoom did not increase zoom: ${JSON.stringify(map)}`);
}
if (!cytoscapeTooltip.includes("Area:") || !cytoscapeTooltip.includes("Domain:")) {
  throw new Error(`Cytoscape tooltip did not expose title and area/domain decoder: ${cytoscapeTooltip}`);
}
if (consoleErrors.length) {
  throw new Error(`console/page errors: ${consoleErrors.join(" | ")}`);
}
if (failedRequests.length) {
  throw new Error(`same-origin failed requests: ${failedRequests.join(" | ")}`);
}
if (badResponses.length) {
  throw new Error(`same-origin bad responses: ${badResponses.join(" | ")}`);
}

await browser.close();
