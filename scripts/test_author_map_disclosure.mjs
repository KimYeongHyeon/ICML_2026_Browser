import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("author map discloses the limits of topic and affiliation evidence", async () => {
  // Given: the visible author-map source.
  const source = await readFile(new URL("../docs/site/author-map.mjs", import.meta.url), "utf8");

  // When: its reading key and active-query note are rendered.

  // Then: users receive the required evidence limitations.
  assert.match(source, /primary reviewed Core concept; this is an authorship view, not corpus prevalence/i);
  assert.match(source, /topic matches plus their recurring mapped collaborators/i);
  assert.match(source, /not verified institutional affiliations/i);
});
