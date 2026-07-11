import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("build_people_topics pins the exact final people JSON bytes in the index manifest", async () => {
  // Given: finalized concepts, index records, and an existing index manifest.
  const directory = await mkdtemp(join(tmpdir(), "icml-people-topics-builder-test-"));
  const indexPath = join(directory, "index.json");
  const conceptsPath = join(directory, "concepts.json");
  const outputPath = join(directory, "people.json");
  const manifestPath = join(directory, "index.manifest.json");
  const conceptFingerprint = `sha256:${"a".repeat(64)}`;
  await Promise.all([
    writeFile(indexPath, JSON.stringify({
      generatedAt: "fixture-index-v1",
      records: [
        { id: "paper:1", type: "paper", title: "Sparse routing", authors: "Ada Lovelace" },
        { id: "paper:2", type: "workshop", title: "Reliable routing", authors: "Grace Hopper" },
      ],
    })),
    writeFile(conceptsPath, JSON.stringify({
      schemaVersion: "icml-concepts/v1",
      fingerprints: { artifact: conceptFingerprint },
      records: {
        "paper:1": { core: ["Sparse expert routing"], detail: [] },
        "paper:2": { core: ["Reliable routing"], detail: [] },
      },
      summary: {
        candidateRecordCount: 2,
        publishedRecordCount: 2,
        excludedRecordCount: 0,
        exclusionCounts: {},
      },
    })),
    writeFile(manifestPath, JSON.stringify({ generatedAt: "fixture-index-v1", preserved: true })),
  ]);
  try {
    // When: the builder serializes the final analysis artifact.
    await run(process.execPath, [
      "scripts/build_people_topics.mjs",
      "--index", indexPath,
      "--concepts", conceptsPath,
      "--output", outputPath,
      "--manifest", manifestPath,
      "--expected-records", "2",
    ], { cwd: root });

    // Then: the manifest preserves its fields and pins the exact emitted bytes.
    const [artifactBytes, manifest] = await Promise.all([
      readFile(outputPath),
      readFile(manifestPath, "utf8").then(JSON.parse),
    ]);
    assert.equal(manifest.preserved, true);
    assert.equal(
      manifest.peopleTopicsArtifactFingerprint,
      `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
