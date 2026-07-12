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

await page.setViewportSize({ width: 390, height: 844 });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

await browser.close();
if (!topic || !/^\d[\d,]* mapped records$/u.test(filteredCount) || filteredCount === allCount) throw new Error(`Landscape filter did not narrow records: ${allCount} -> ${filteredCount}`);
if (mapSearch || !coreSummary.includes(`Core: ${topic}`) || !/^\d[\d,]* mapped records$/u.test(coreCount)) throw new Error(`Core handoff failed: ${JSON.stringify({ topic, coreSummary, coreCount, mapSearch })}`);
if (mobileOverflow || errors.length) throw new Error(`Topic Explorer browser errors: ${JSON.stringify({ mobileOverflow, errors })}`);
console.log(JSON.stringify({ allCount, filteredCount, topic, coreCount, mobileOverflow }, null, 2));
