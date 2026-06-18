import { chromium } from "playwright";

const rawBaseUrl = process.argv[2] || "http://127.0.0.1:57995/";
const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;

const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-webgl", "--use-gl=angle"],
});

async function scanTooltip(page) {
  const canvasBox = await page.locator("canvas").first().boundingBox();
  if (!canvasBox) return "";
  const points = [];
  for (const px of [0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.88]) {
    for (const py of [0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.88]) {
      points.push([px, py]);
    }
  }
  for (const [px, py] of points) {
    await page.mouse.move(canvasBox.x + canvasBox.width * px, canvasBox.y + canvasBox.height * py);
    await page.waitForTimeout(90);
    const text = await page.evaluate(() => {
      const tooltips = [...document.querySelectorAll(".graph-tooltip")].filter((item) => !item.hidden);
      return tooltips.map((item) => item.textContent || "").find(Boolean) || "";
    });
    if (text) return text;
  }
  return "";
}

async function verifyPage(path, expectedEngineText) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(baseUrl)) {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.trim());
    }
  });

  await page.goto(new URL(path, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => {
    const state = document.querySelector("#graphStatus")?.dataset.state;
    return state === "ready" || state === "error";
  }, null, { timeout: 45000 });
  await page.waitForTimeout(600);

  const report = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const box = canvas?.getBoundingClientRect();
    return {
      status: document.querySelector("#graphStatus")?.textContent || "",
      state: document.querySelector("#graphStatus")?.dataset.state || "",
      canvasCount: document.querySelectorAll("canvas").length,
      canvasWidth: box?.width || 0,
      canvasHeight: box?.height || 0,
      areaOptions: document.querySelector("#areaFilter")?.options.length || 0,
      detailText: document.querySelector("#graphDetail")?.innerText || "",
    };
  });
  const tooltip = await scanTooltip(page);
  const fullReport = {
    path,
    ...report,
    tooltip,
    consoleErrors,
    failedRequests,
  };
  console.log(JSON.stringify(fullReport, null, 2));

  if (report.state !== "ready") throw new Error(`${path} did not reach ready state: ${report.status}`);
  if (!report.status.includes(expectedEngineText)) throw new Error(`${path} did not report expected engine text: ${report.status}`);
  if (report.canvasCount < 1 || report.canvasWidth < 500 || report.canvasHeight < 500) {
    throw new Error(`${path} graph canvas is missing or too small: ${JSON.stringify(report)}`);
  }
  if (report.areaOptions < 8) throw new Error(`${path} did not populate area filters`);
  if (!/Select a point|Paper|Poster|Workshop/i.test(report.detailText)) throw new Error(`${path} detail panel did not render`);
  if (!tooltip.includes("Area:") || !tooltip.includes("Domain:")) {
    throw new Error(`${path} hover tooltip did not expose title and area/domain: ${tooltip}`);
  }
  if (consoleErrors.length) throw new Error(`${path} console/page errors: ${consoleErrors.join(" | ")}`);
  if (failedRequests.length) throw new Error(`${path} same-origin request failures: ${failedRequests.join(" | ")}`);
  await page.close();
}

try {
  await verifyPage("sigma.html", "Sigma.js");
  await verifyPage("cosmograph.html", "Cosmograph blocked, canvas fallback");
} finally {
  await browser.close();
}
