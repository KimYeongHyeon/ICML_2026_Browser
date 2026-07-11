import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

globalThis.window = { location: { pathname: "" } };
const { renderTopicTrends } = await import("../docs/site/people-dashboard.mjs");

test("renderTopicTrends exposes reviewed Core concepts as keyboard-operable map actions", () => {
  const html = renderTopicTrends({
    note: "Single-year prevalence.",
    topics: [{ label: "Concept erasure", workCount: 3, workShare: 0.25 }],
  });

  assert.match(html, /Topics in this 2026 corpus/);
  assert.match(html, /data-people-topic="Concept erasure"/);
  assert.match(html, /type="button"/);
  assert.match(html, /Explore related papers on Map/);
  assert.doesNotMatch(html, /trend|growth|rising|momentum/i);
});

test("People topic cards remain full-width at the mobile breakpoint", async () => {
  const styles = await readFile(new URL("../docs/site/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.people-topic-prevalence \.author-map-insight-grid\s*\{\s*grid-template-columns:\s*1fr;/);
});
