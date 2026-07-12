import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:57995/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator('.tab[data-tab="map"]').click();
await page.locator("[data-landscape-cluster-id]").first().waitFor({ state: "visible", timeout: 30000 });
const allCount = await page.locator("#resultCount").innerText();
await page.locator("[data-landscape-cluster-id]").first().click();
await page.locator("[data-clear-landscape]").waitFor({ state: "visible", timeout: 30000 });
const filteredCount = await page.locator("#resultCount").innerText();
await page.locator("[data-clear-landscape]").click();

await page.locator('.tab[data-tab="people"]').click();
await page.locator("[data-people-topic]").first().waitFor({ state: "visible", timeout: 30000 });
const topic = await page.locator("[data-people-topic]").first().getAttribute("data-people-topic");
await page.locator("[data-people-topic]").first().click();
await page.locator("[data-clear-map-core-concept-filter]").waitFor({ state: "visible", timeout: 30000 });
const coreSummary = await page.locator("#activeSummary").innerText();
const coreCount = await page.locator("#resultCount").innerText();
const mapSearch = await page.locator("#mapSearchInput").inputValue();

await page.locator('.tab[data-tab="topics"]').click();
await page.locator(".topics-dashboard").waitFor({ state: "visible", timeout: 30000 });
await page.locator("#topicsScope").selectOption("main");
await page.locator("#topicsSearch").fill("concept erasure");
await page.locator("[data-topic-label]").first().waitFor({ state: "visible", timeout: 30000 });
const selectedTopic = await page.locator("[data-topic-label]").first().getAttribute("data-topic-label");
await page.locator("[data-topic-label]").first().click();
await page.locator(".topic-focus").waitFor({ state: "visible", timeout: 30000 });
const matchingWorks = await page.locator(".topic-work-list button").count();
await page.locator("[data-open-author-map-topic]").click();
await page.locator(".author-map-dashboard").waitFor({ state: "visible", timeout: 30000 });
const authorTopicQuery = await page.locator("#authorMapSearch").inputValue();
const authorTopicScope = await page.locator("#authorMapScope").inputValue();
const authorTabActive = await page.locator('.tab[data-tab="people"]').evaluate((tab) => tab.classList.contains("is-active"));
const authorMapViewActive = await page.locator('[data-author-view="map"]').evaluate((tab) => tab.classList.contains("is-active"));

await page.locator('.tab[data-tab="topics"]').click();
await page.locator("#topicsSearch").fill("ODE");
await page.locator("[data-topic-label]").first().waitFor({ state: "visible", timeout: 30000 });
const odeTopic = await page.locator("[data-topic-label]").first().getAttribute("data-topic-label");
await page.locator("[data-topic-label]").first().click();
await page.locator("[data-explore-core-topic]").click();
await page.locator("[data-clear-map-core-concept-filter]").waitFor({ state: "visible", timeout: 30000 });
const topicsMapSummary = await page.locator("#activeSummary").innerText();

await page.locator('.tab[data-tab="people"]').click();
await page.locator('[data-author-view="map"]').click();
await page.locator(".author-map-dashboard").waitFor({ state: "visible", timeout: 30000 });
await page.locator("#authorMapSearch").fill("energy-based temperature calibration");
await page.locator(".author-map-graph-empty").waitFor({ state: "visible", timeout: 30000 });
const emptyTopicCanvasCount = await page.locator("#authorMapCanvas").count();
const emptyTopicDetail = await page.locator("#authorMapDetail").innerText();

await page.locator('.tab[data-tab="paper"]').click();
await page.locator(".result-item").first().waitFor({ state: "visible", timeout: 30000 });
await page.locator('.tab[data-tab="people"]').click();
await page.locator('[data-author-view="map"]').click();
await page.locator(".author-map-dashboard").waitFor({ state: "visible", timeout: 30000 });
const directAuthorQuery = await page.locator("#authorMapSearch").inputValue();
const directAuthorScope = await page.locator("#authorMapScope").inputValue();

await page.setViewportSize({ width: 390, height: 844 });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

await browser.close();
if (!topic || !/^\d[\d,]* mapped records$/u.test(filteredCount) || filteredCount === allCount) throw new Error(`Landscape filter did not narrow records: ${allCount} -> ${filteredCount}`);
if (mapSearch || !coreSummary.includes(`Core: ${topic}`) || !/^\d[\d,]* mapped records$/u.test(coreCount)) throw new Error(`Core handoff failed: ${JSON.stringify({ topic, coreSummary, coreCount, mapSearch })}`);
if (!selectedTopic || matchingWorks < 1 || authorTopicQuery !== selectedTopic || authorTopicScope !== "main" || !authorTabActive || !authorMapViewActive || !/\bODE\b/u.test(odeTopic || "") || topicsMapSummary.indexOf("Core: " + odeTopic) === -1) {
  throw new Error(`Topics explorer handoffs failed: ${JSON.stringify({ selectedTopic, matchingWorks, authorTopicQuery, authorTopicScope, authorTabActive, authorMapViewActive, odeTopic, topicsMapSummary })}`);
}
if (emptyTopicCanvasCount || !emptyTopicDetail.includes("No recurring island in this selection")) {
  throw new Error(`Topic-to-author-map empty state failed: ${JSON.stringify({ emptyTopicCanvasCount, emptyTopicDetail })}`);
}
if (directAuthorQuery || directAuthorScope !== "all") {
  throw new Error(`Direct Author navigation must clear the prior topic map context: ${JSON.stringify({ directAuthorQuery, directAuthorScope })}`);
}
if (mobileOverflow || errors.length) throw new Error(`Topic Explorer browser errors: ${JSON.stringify({ mobileOverflow, errors })}`);
console.log(JSON.stringify({ allCount, filteredCount, topic, coreCount, selectedTopic, matchingWorks, authorTopicScope, authorTabActive, authorMapViewActive, odeTopic, emptyTopicCanvasCount, directAuthorScope, mobileOverflow }, null, 2));
