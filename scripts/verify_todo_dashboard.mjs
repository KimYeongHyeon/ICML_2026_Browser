import fs from "node:fs/promises";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8765/";
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const paths = {
  desktopOverview: `/tmp/verify-todo-dashboard-${stamp}-desktop-overview.png`,
  desktopDetail: `/tmp/verify-todo-dashboard-${stamp}-desktop-detail.png`,
  mobileDetail: `/tmp/verify-todo-dashboard-${stamp}-mobile-detail.png`,
  report: `/tmp/verify-todo-dashboard-${stamp}.json`,
};

const browser = await chromium.launch({ headless: false });
const failures = [];
const observations = [];

function attachDiagnostics(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`${label} pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`${label} requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

async function expectVisible(page, selector, label) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0 || !(await locator.isVisible())) {
    failures.push(`missing or hidden ${label}: ${selector}`);
  }
}

async function layoutAudit(page, label, selectors) {
  const issues = await page.evaluate(({ selectors: present, tolerance }) => {
    const found = [];
    for (const selector of present) {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) found.push(`MISSING: ${selector}`);
      elements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        if (rect.width + rect.height === 0) found.push(`ZERO-SIZE: ${selector}#${index}`);
      });
    }
    if (document.documentElement.scrollWidth > innerWidth + tolerance) {
      found.push(`PAGE OVERFLOW: ${document.documentElement.scrollWidth} > ${innerWidth}`);
    }
    return found;
  }, { selectors, tolerance: 2 });
  failures.push(...issues.map((issue) => `${label} ${issue}`));
  return issues;
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  attachDiagnostics(desktop, "desktop");
  const response = await desktop.goto(url, { waitUntil: "networkidle" });
  if (!response || response.status() !== 200) failures.push(`desktop page status: ${response?.status() ?? "no response"}`);

  await expectVisible(desktop, "h1", "title");
  await expectVisible(desktop, "#verdict", "verdict");
  await expectVisible(desktop, "#tiles .tile", "progress tiles");
  await expectVisible(desktop, '[data-pane="pane-item"]', "Milestone tab");
  await layoutAudit(desktop, "desktop overview", ["header", "#verdict", ".tabs", "#tiles"]);

  const title = (await desktop.locator("h1").innerText()).trim();
  const verdict = (await desktop.locator("#verdict h3").innerText()).trim();
  const visibleText = await desktop.locator("body").innerText();
  if (visibleText.includes("**") || visibleText.includes("`")) failures.push("desktop visible text contains raw Markdown markers");
  observations.push({ title, verdict });
  await desktop.screenshot({ path: paths.desktopOverview, fullPage: true });

  await desktop.locator('[data-pane="pane-item"]').click();
  await expectVisible(desktop, "#unitGrid .unit-card", "Milestone cards");
  await expectVisible(desktop, "#todoItemsSection", "todo detail");
  await desktop.locator("#todoSourceSelect").selectOption("monitor");
  await desktop.locator('#todoStatusFilter [data-status="open"]').click();
  const visibleTodoRows = desktop.locator('.todo-source[data-source="monitor"] .todo-row:visible');
  const visibleDoneRows = desktop.locator('.todo-source[data-source="monitor"] .todo-row.done:visible');
  if ((await visibleTodoRows.count()) === 0) failures.push("monitor open filter produced no rows");
  if ((await visibleDoneRows.count()) !== 0) failures.push("monitor open filter still shows completed rows");

  const beforeTheme = await desktop.locator("html").getAttribute("data-theme");
  await desktop.locator("#themeBtn").click();
  const afterTheme = await desktop.locator("html").getAttribute("data-theme");
  if (!afterTheme || afterTheme === beforeTheme) failures.push("theme toggle did not change the selected theme");
  await layoutAudit(desktop, "desktop detail", ["#unitGrid", "#todoItemsSection", ".todo-toolbar"]);
  await desktop.screenshot({ path: paths.desktopDetail, fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  attachDiagnostics(mobile, "mobile");
  const mobileResponse = await mobile.goto(`${url}#pane-item`, { waitUntil: "networkidle" });
  if (!mobileResponse || mobileResponse.status() !== 200) failures.push(`mobile page status: ${mobileResponse?.status() ?? "no response"}`);
  await expectVisible(mobile, "#unitGrid .unit-card", "mobile Milestone cards");
  await expectVisible(mobile, "#todoItemsSection", "mobile todo detail");
  await mobile.locator("#todoSourceSelect").selectOption("implementation");
  await mobile.locator('#todoStatusFilter [data-status="open"]').click();
  await layoutAudit(mobile, "mobile detail", ["header", "#verdict", ".tabs", "#unitGrid", "#todoItemsSection"]);
  await mobile.screenshot({ path: paths.mobileDetail, fullPage: true });

  observations.push({
    desktopTodoRows: await visibleTodoRows.count(),
    mobileWidth: await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth })),
    theme: afterTheme,
  });
} finally {
  await browser.close();
}

const report = {
  url,
  timestamp: new Date().toISOString(),
  pass: failures.length === 0,
  failures,
  observations,
  screenshots: paths,
};
await fs.writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
