import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:57995/";

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

const map = await page.evaluate(() => ({
  activeSummary: document.querySelector("#activeSummary")?.innerText || "",
  hasCanvas: Boolean(document.querySelector("#mapCanvas canvas")),
}));

const report = {
  baseUrl,
  initial,
  paper,
  paperSpotlight,
  afterSwitch,
  map,
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
