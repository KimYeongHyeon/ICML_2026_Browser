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

function isBenignConsoleError(text) {
  const value = String(text || "").trim();
  return /^Worker was terminated\.?$/i.test(value)
    || /huggingface\.co\/benchoi93\/specter2-base-onnx-web\/resolve\/main\/config\.json/i.test(value)
    || /^Failed to load resource: net::ERR_FAILED$/i.test(value);
}

function isSameOrigin(url) {
  return url.startsWith(baseUrl) || url.startsWith(new URL(baseUrl).origin);
}

page.on("console", (message) => {
  if (message.type() === "error" && !isBenignConsoleError(message.text())) consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  if (!isBenignConsoleError(error.message)) consoleErrors.push(error.message);
});
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

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".result-item", { timeout: 30000 });

const initial = await page.evaluate(() => ({
  note: document.querySelector(".data-note")?.innerText || "",
  headerStats: document.querySelector("#headerStats")?.innerText || "",
  paperHidden: document.querySelector('.tab[data-tab="paper"]')?.hidden || false,
  paperActive: document.querySelector('.tab[data-tab="paper"]')?.classList.contains("is-active") || false,
  posterTabExists: Boolean(document.querySelector('.tab[data-tab="poster"]')),
  resultCount: document.querySelector("#resultCount")?.innerText || "",
  hasPosterSessionBadge: Boolean([...document.querySelectorAll(".result-item .badge.poster-session")].length),
}));

const embeddingLookupCompleteness = await page.evaluate(async () => {
  const [index, map, manifest] = await Promise.all([
    fetch("site/data/icml2026_index.json").then((response) => response.json()),
    fetch("site/data/icml2026_map.json").then((response) => response.json()),
    fetch("site/data/icml2026_index.manifest.json").then((response) => response.json()),
  ]);
  const shards = await Promise.all((manifest.shards || []).map((shard) => fetch(shard.url).then((response) => response.json())));
  const records = [
    ...(index.records || []),
    ...(map.records || []),
    ...shards.flatMap((shard) => shard.records || []),
  ];
  const clusters = new Map((map.embeddingClusters || []).map((cluster) => [cluster.id, cluster]));
  const missing = [];
  for (const record of records) {
    if (!record.embeddingClusterId) continue;
    const cluster = clusters.get(record.embeddingClusterId);
    if (!cluster?.label || !Array.isArray(cluster.topTerms)) {
      missing.push(`${record.id}:${record.embeddingClusterId}`);
    }
  }
  return {
    clusterCount: clusters.size,
    checkedRecords: records.length,
    missingCount: missing.length,
    firstMissing: missing.slice(0, 5),
  };
});

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
  viewerFrameText: document.querySelector("#viewerFrame")?.innerText || "",
  viewerAbstractText: document.querySelector(".viewer-abstract-body")?.innerText || "",
  actionLabels: [...document.querySelectorAll("#viewerActions .action")].map((item) => item.textContent || ""),
  openReviewPdfHref: [...document.querySelectorAll("#viewerActions .action")]
    .find((item) => (item.textContent || "").includes("OpenReview PDF"))?.href || "",
}));
await page.waitForSelector(".mini-graph canvas", { timeout: 30000 });
await page.evaluate(() => document.querySelector(".mini-graph")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(1900);
const miniInitialFit = await page.evaluate(() => {
  const graph = document.querySelector(".mini-graph");
  const box = graph?.getBoundingClientRect();
  const points = window.__icmlMapDebug?.miniProbePoints?.(40) || [];
  const outside = box ? points.filter((point) => point.x < 8 || point.y < 8 || point.x > box.width - 8 || point.y > box.height - 8) : points;
  return {
    points: points.length,
    outside: outside.slice(0, 5),
    hasStudyPack: /Topic study pack/i.test(document.querySelector("#viewerFrame")?.innerText || ""),
  };
});
const miniProbePoints = await page.evaluate(() => window.__icmlMapDebug?.miniProbePoints?.(40) || []);
const miniTooltip = await scanGraphTooltipAtPoints(".mini-graph", miniProbePoints) || await scanGraphTooltip(".mini-graph", centerGrid);
const miniControlsBefore = await page.evaluate(() => ({
  labels: [...document.querySelectorAll(".mini-graph-control")].map((item) => item.textContent?.trim() || ""),
  info: window.__icmlMapDebug?.miniGraphInfo?.() || {},
}));
await page.locator('.mini-graph-control[data-mini-action="zoom-in"]').click();
await page.waitForTimeout(120);
const miniAfterZoom = await page.evaluate(() => window.__icmlMapDebug?.miniGraphInfo?.() || {});
await page.locator('.mini-graph-control[data-mini-action="depth"]').click();
await page.waitForSelector(".mini-graph canvas", { timeout: 30000 });
await page.waitForTimeout(900);
const miniAfterDepth = await page.evaluate(() => ({
  button: document.querySelector('.mini-graph-control[data-mini-action="depth"]')?.textContent?.trim() || "",
  info: window.__icmlMapDebug?.miniGraphInfo?.() || {},
}));

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

await page.locator("#searchInput").fill("MoSE: Mixture of Slimmable Experts");
await page.waitForTimeout(300);
await page.locator(".result-item").first().click();
await page.waitForSelector(".pdfjs-shell", { timeout: 30000 });
await page.waitForFunction(() => {
  const shell = document.querySelector(".pdfjs-shell");
  const status = shell?.querySelector("[data-pdf-status]")?.textContent || "";
  return shell && !shell.classList.contains("has-error") && /\d+ \/ \d+/.test(status);
}, null, { timeout: 30000 });
const localPdf = await page.evaluate(() => ({
  viewerTitle: document.querySelector("#viewerTitle")?.innerText || "",
  shellExists: Boolean(document.querySelector(".pdfjs-shell")),
  hasError: Boolean(document.querySelector(".pdfjs-shell.has-error")),
  status: document.querySelector("[data-pdf-status]")?.textContent || "",
  source: document.querySelector(".pdfjs-shell")?.dataset.pdfSrc || "",
  canvasWidth: document.querySelector("[data-pdf-canvas]")?.width || 0,
  canvasHeight: document.querySelector("[data-pdf-canvas]")?.height || 0,
}));

await page.locator('.tab[data-tab="map"]').click();
await page.waitForSelector("#mapCanvas canvas", { timeout: 30000 });
await page.waitForSelector(".trend-card", { timeout: 30000 });
const trendsInitial = await page.evaluate(() => ({
  heading: document.querySelector(".trend-panel-head h3")?.textContent || "",
  cardCount: document.querySelectorAll(".trend-card").length,
  firstKeywords: document.querySelector(".trend-keywords")?.textContent || "",
  firstRepresentatives: document.querySelectorAll(".trend-representatives button").length,
  firstSummary: document.querySelector(".trend-card p")?.textContent || "",
}));
await page.locator(".trend-card-main").first().click();
await page.waitForTimeout(500);
const trendCardClick = await page.evaluate(() => ({
  selectedTitle: document.querySelector(".map-detail-card h3")?.textContent || "",
  viewerTitle: document.querySelector("#viewerTitle")?.textContent || "",
}));
await page.locator('.tab[data-tab="workshop"]').click();
await page.waitForTimeout(200);
await page.locator('.tab[data-tab="map"]').click();
await page.waitForSelector(".trend-card", { timeout: 30000 });
await page.locator(".trend-representatives button").first().click();
await page.waitForTimeout(500);
const trendRepresentativeClick = await page.evaluate(() => ({
  selectedTitle: document.querySelector(".map-detail-card h3")?.textContent || "",
  viewerTitle: document.querySelector("#viewerTitle")?.textContent || "",
}));
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

await page.locator("#mapSearchInput").fill("retrieval");
await page.waitForTimeout(900);
const mapSearch = await page.evaluate(() => ({
  seedCount: window.__icmlMapDebug?.mapSearchInfo?.().seedCount || 0,
  semanticCount: window.__icmlMapDebug?.mapSearchInfo?.().semanticCount || 0,
  kind: window.__icmlMapDebug?.mapSearchInfo?.().kind || "",
  topScore: window.__icmlMapDebug?.mapSearchInfo?.().topScore || 0,
  pending: Boolean(window.__icmlMapDebug?.mapSearchInfo?.().pending),
  resultCount: document.querySelector("#resultCount")?.innerText || "",
  activeSummary: document.querySelector("#activeSummary")?.innerText || "",
}));

await page.locator("#mapEngineSelect").selectOption("cytoscape", { force: true });
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
await page.locator("#mapColorSelect").selectOption("embedding-cluster", { force: true });
await page.waitForTimeout(900);
const embeddingMap = await page.evaluate(() => ({
  activeSummary: document.querySelector("#activeSummary")?.innerText || "",
  colorValue: document.querySelector("#mapColorSelect")?.value || "",
  clusterLevelValue: document.querySelector("#mapClusterLevelSelect")?.value || "",
  legendItems: [...document.querySelectorAll(".legend-item")].map((item) => item.textContent || ""),
  showMoreText: document.querySelector(".legend-more")?.textContent || "",
  expectedLabels: ((window.__icmlMapDebug?.mapData?.().embeddingClusterLevels || [])
    .find((level) => String(level.k) === (document.querySelector("#mapClusterLevelSelect")?.value || ""))
    ?.clusters || [])
    .slice(0, 8)
    .map((cluster) => cluster.label || cluster.id),
  expectedCount: (window.__icmlMapDebug?.mapData?.().embeddingClusterLevels || [])
    .find((level) => String(level.k) === (document.querySelector("#mapClusterLevelSelect")?.value || ""))
    ?.clusters.length || 0,
}));
const hiddenEmbeddingLegendCount = Number(embeddingMap.showMoreText.match(/\(([\d,]+)\)/)?.[1]?.replace(/,/g, "") || 0);
if (hiddenEmbeddingLegendCount) await page.locator(".legend-more").click();
await page.waitForTimeout(250);
const embeddingExpandedMap = await page.evaluate(() => ({
  legendItems: [...document.querySelectorAll(".legend-item")].map((item) => item.textContent || ""),
  showMoreText: document.querySelector(".legend-more")?.textContent || "",
  swatches: [...document.querySelectorAll(".legend-swatch")]
    .slice(1)
    .map((item) => getComputedStyle(item).backgroundColor),
}));
await page.locator("#mapSearchInput").fill("");
await page.waitForTimeout(900);
await page.locator("#mapClusterLevelSelect").selectOption("30", { force: true });
await page.waitForTimeout(600);
const embeddingLevel30 = await page.evaluate(() => ({
  activeSummary: document.querySelector("#activeSummary")?.innerText || "",
  clusterLevelValue: document.querySelector("#mapClusterLevelSelect")?.value || "",
  legendItems: [...document.querySelectorAll(".legend-item")].map((item) => item.textContent || ""),
  showMoreText: document.querySelector(".legend-more")?.textContent || "",
  expectedCount: (window.__icmlMapDebug?.mapData?.().embeddingClusterLevels || [])
    .find((level) => String(level.k) === "30")
    ?.clusters.length || 0,
  resultCount: document.querySelector("#resultCount")?.innerText || "",
}));
await page.locator(".legend-more").click();
await page.waitForTimeout(250);
const embeddingLevel30Expanded = await page.evaluate(() => ({
  legendItems: [...document.querySelectorAll(".legend-item")].map((item) => item.textContent || ""),
  showMoreText: document.querySelector(".legend-more")?.textContent || "",
  swatches: [...document.querySelectorAll(".legend-swatch")]
    .slice(1)
    .map((item) => getComputedStyle(item).backgroundColor),
}));

await page.locator('.tab[data-tab="paper"]').click();
await page.waitForTimeout(200);
await page.locator("#searchInput").fill("cluster 01");
await page.waitForTimeout(700);
const clusterLabelSearch = await page.evaluate(() => {
  const resultCount = document.querySelector("#resultCount")?.innerText || "";
  const parsedCount = Number((resultCount.match(/[\d,]+/)?.[0] || "0").replaceAll(",", ""));
  return {
    query: document.querySelector("#searchInput")?.value || "",
    resultCount,
    parsedCount,
    firstTitle: document.querySelector(".result-item .result-title")?.innerText || "",
  };
});

const report = {
  baseUrl,
  initial,
  embeddingLookupCompleteness,
  paper,
  paperSpotlight,
  paperLatex,
  localPdf,
  miniTooltip,
  miniControlsBefore,
  miniAfterZoom,
  miniAfterDepth,
  afterSwitch,
  trendsInitial,
  trendCardClick,
  trendRepresentativeClick,
  map,
  embeddingMap,
  clusterLabelSearch,
  mapSearch,
  mapTooltip,
  cytoscapeTooltip,
  consoleErrors,
  failedRequests,
  badResponses,
};

console.log(JSON.stringify(report, null, 2));

if (initial.posterTabExists) {
  throw new Error("Poster should not be a top-level tab; it is a paper presentation badge");
}
if (initial.paperHidden || !initial.paperActive) {
  throw new Error("Paper tab should be the visible default");
}
if (!/^6,343 results/.test(initial.resultCount)) {
  throw new Error(`unexpected initial paper count: ${initial.resultCount}`);
}
if (!initial.hasPosterSessionBadge) {
  throw new Error("Paper results should show poster presentation badges");
}
if (!initial.headerStats.includes("7,066") || !initial.headerStats.includes("records") || !/\n\d+\narea groups/.test(initial.headerStats) || !initial.headerStats.includes("723") || !initial.headerStats.includes("workshops")) {
  throw new Error(`header should match compact design stats: ${initial.headerStats}`);
}
if (embeddingLookupCompleteness.clusterCount <= 0 || embeddingLookupCompleteness.missingCount !== 0) {
  throw new Error(`embedding cluster lookup metadata must be complete for searchable labels/keywords: ${JSON.stringify(embeddingLookupCompleteness)}`);
}
if (!/^6,343 results/.test(paper.resultCount)) {
  throw new Error(`unexpected paper count: ${paper.resultCount}`);
}
if (!paperSpotlight.hasSpotlightBadge || /^0 results/.test(paperSpotlight.resultCount)) {
  throw new Error(`Paper tab should expose searchable Spotlight badges: ${JSON.stringify(paperSpotlight)}`);
}
if (paperLatex.viewerKind.includes("Paper · Poster")) {
  throw new Error(`regular poster presentation leaked into paper identity: ${JSON.stringify(paperLatex)}`);
}
if (!paperLatex.viewerKind.includes("PAPER · MAIN CONFERENCE")) {
  throw new Error(`paper identity should stay main-conference even when ICML source URL is /poster/{id}: ${JSON.stringify(paperLatex)}`);
}
if (/Poster source page/i.test(paperLatex.viewerFrameText) || !/Official paper presentation page/i.test(paperLatex.viewerFrameText)) {
  throw new Error(`paper /poster/{id} source page should be labeled as a paper presentation page: ${JSON.stringify(paperLatex)}`);
}
if (!paperLatex.viewerMeta.includes("OpenReview PDF") || /\nBlocked\n/.test(paperLatex.viewerMeta)) {
  throw new Error(`paper viewer should show OpenReview PDF instead of raw Blocked: ${JSON.stringify(paperLatex)}`);
}
if (/403|not yet public|return 403/i.test(paperLatex.viewerMeta)) {
  throw new Error(`paper viewer metadata should not foreground crawler-only PDF failures when OpenReview PDF action exists: ${JSON.stringify(paperLatex)}`);
}
if (!paperLatex.actionLabels.includes("OpenReview PDF") || !paperLatex.openReviewPdfHref.includes("openreview.net/pdf?id=H0tMEp0ZmO")) {
  throw new Error(`paper viewer should expose a direct OpenReview PDF action: ${JSON.stringify(paperLatex)}`);
}
if (!localPdf.viewerTitle.includes("MoSE") || !localPdf.shellExists || localPdf.hasError || !/\d+ \/ \d+/.test(localPdf.status) || !localPdf.canvasWidth || !localPdf.canvasHeight) {
  throw new Error(`downloaded PDF should render through PDF.js: ${JSON.stringify(localPdf)}`);
}
if (/texttt|\\texttt|\{Multi\}/.test(`${paperLatex.resultTitle} ${paperLatex.viewerTitle}`)) {
  throw new Error(`raw LaTeX command leaked into paper title: ${JSON.stringify(paperLatex)}`);
}
if (paperLatex.viewerAbstractText && /\\(?:texttt|mathrm|mathbb|mathcal)|\{[^{}]+\}|𝑜\s*𝑏\s*𝑗/.test(paperLatex.viewerAbstractText)) {
  throw new Error(`abstract text-like math should render as clean prose: ${JSON.stringify(paperLatex)}`);
}
if (!miniTooltip.includes("Area:") || !miniTooltip.includes("Domain:")) {
  throw new Error(`mini semantic graph tooltip did not expose title and area/domain decoder: ${miniTooltip}`);
}
if (miniInitialFit.hasStudyPack || miniInitialFit.points === 0 || miniInitialFit.outside.length) {
  throw new Error(`mini semantic graph should start fitted and should not duplicate Topic study pack: ${JSON.stringify(miniInitialFit)}`);
}
if (!miniControlsBefore.labels.includes("Fit") || !miniControlsBefore.labels.some((label) => label.includes("Depth: 1-hop")) || miniControlsBefore.info.depth !== "first") {
  throw new Error(`mini semantic graph controls missing or wrong initial depth: ${JSON.stringify(miniControlsBefore)}`);
}
if (!Number.isFinite(miniControlsBefore.info.zoom) || !Number.isFinite(miniAfterZoom.zoom) || miniAfterZoom.zoom <= miniControlsBefore.info.zoom) {
  throw new Error(`mini semantic graph zoom-in control did not increase zoom: ${JSON.stringify({ miniControlsBefore, miniAfterZoom })}`);
}
if (miniAfterDepth.info.depth !== "deep" || miniAfterDepth.info.nodes <= miniControlsBefore.info.nodes || !miniAfterDepth.button.includes("Deeper")) {
  throw new Error(`mini semantic graph depth toggle did not expose a denser view: ${JSON.stringify({ miniControlsBefore, miniAfterDepth })}`);
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
if (
  trendsInitial.heading !== "Research currents"
  || trendsInitial.cardCount < 4
  || !trendsInitial.firstKeywords.trim()
  || trendsInitial.firstRepresentatives < 3
  || !trendsInitial.firstSummary.includes("This trend groups papers around")
) {
  throw new Error(`semantic trend cards should expose keywords, summary, and representative papers: ${JSON.stringify(trendsInitial)}`);
}
if (!trendCardClick.selectedTitle || !trendCardClick.viewerTitle) {
  throw new Error(`clicking a trend card should focus a representative record: ${JSON.stringify(trendCardClick)}`);
}
if (!trendRepresentativeClick.selectedTitle || !trendRepresentativeClick.viewerTitle) {
  throw new Error(`clicking a trend representative should open the existing viewer: ${JSON.stringify(trendRepresentativeClick)}`);
}
if (!map.hasCanvas || !map.activeSummary.includes("Map")) {
  throw new Error(`map smoke failed: ${JSON.stringify(map)}`);
}
if (!map.colorLabels.includes("Area + Domain") || !map.colorLabels.includes("Research area") || !map.colorLabels.includes("Embedding cluster") || !map.colorLabels.includes("Semantic area group")) {
  throw new Error(`map color labels should distinguish area, domain, embedding cluster, and semantic group modes: ${JSON.stringify(map)}`);
}
if (!map.activeSummary.includes("global") || !map.activeSummary.includes("area + domain")) {
  throw new Error(`map summary should include both scope and color mode: ${JSON.stringify(map)}`);
}
if (map.colorValue !== "area-domain" || !map.legendNote.includes("Fill = research area") || !map.legendNote.includes("Ring = domain")) {
  throw new Error(`area/domain mode should be the default and explain fill/ring semantics: ${JSON.stringify(map)}`);
}
if (/\b(Circle|Square|Diamond|Triangle)\b/.test(map.legendNote)) {
  throw new Error(`area/domain legend should show domain names, not raw shape names: ${JSON.stringify(map)}`);
}
if (!/(Biology|General|Scientific Discovery|Social Science|Robotics|Medical)\s+\d/.test(map.legendNote)) {
  throw new Error(`area/domain legend should label shapes with visible domain names and counts: ${JSON.stringify(map)}`);
}
if (!mapTooltip.includes("Area:") || !mapTooltip.includes("Domain:")) {
  throw new Error(`main ForceGraph tooltip did not expose title and area/domain decoder: ${mapTooltip}`);
}
if (
  embeddingMap.colorValue !== "embedding-cluster"
  || embeddingMap.clusterLevelValue !== "15"
  || !embeddingMap.activeSummary.includes("embedding cluster")
  || !embeddingMap.activeSummary.includes("15 clusters")
  || embeddingMap.expectedCount !== 15
  || embeddingMap.legendItems.length < 4
  || !embeddingMap.expectedLabels.some((label) => embeddingMap.legendItems.some((item) => item.includes(label)))
) {
  throw new Error(`embedding cluster color mode should default to a precomputed 15-cluster level: ${JSON.stringify(embeddingMap)}`);
}
if (
  hiddenEmbeddingLegendCount
  && embeddingExpandedMap.showMoreText
  && !embeddingExpandedMap.showMoreText.includes("Show less")
) {
  throw new Error(`embedding cluster legend should expand filtered coarse clusters: ${JSON.stringify(embeddingExpandedMap)}`);
}
if (
  embeddingLevel30.clusterLevelValue !== "30"
  || embeddingLevel30.expectedCount !== 30
  || !embeddingLevel30.activeSummary.includes("30 clusters")
  || !embeddingLevel30.showMoreText.includes("Show more")
  || embeddingLevel30Expanded.legendItems.length < 31
  || !embeddingLevel30Expanded.showMoreText.includes("Show less")
  || new Set(embeddingLevel30Expanded.swatches).size < Math.min(24, embeddingLevel30Expanded.swatches.length)
) {
  throw new Error(`embedding cluster level selector should expose precomputed 30-cluster map: ${JSON.stringify({ embeddingLevel30, embeddingLevel30Expanded })}`);
}
if (clusterLabelSearch.query !== "cluster 01" || clusterLabelSearch.parsedCount <= 0) {
  throw new Error(`embedding cluster labels should remain searchable without per-record generated labels: ${JSON.stringify(clusterLabelSearch)}`);
}
if (
  !mapSearch.seedCount
  || !["query-vector", "specter2-loading", "specter2-query"].includes(mapSearch.kind)
  || mapSearch.topScore <= 0
  || !/query-vector matches|SPECTER2|lexical fallback/.test(mapSearch.activeSummary)
) {
  throw new Error(`map semantic search should highlight cosine-ranked matches: ${JSON.stringify(mapSearch)}`);
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
