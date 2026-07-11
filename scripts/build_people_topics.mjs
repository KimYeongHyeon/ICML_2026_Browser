import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPeopleTopicsArtifact } from "../docs/site/people-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : resolve(root, fallback);
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node scripts/build_people_topics.mjs [--index PATH] [--concepts PATH] [--output PATH] [--if-ready]\n");
    return;
  }
  const indexPath = option("--index", "docs/site/data/icml2026_index.json");
  const conceptPath = option("--concepts", "docs/site/data/concepts/icml2026_concepts.json");
  const outputPath = option("--output", "docs/site/data/analysis/icml2026_people_topics.json");
  const [indexText, conceptText] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(conceptPath, "utf8"),
  ]);
  const indexPayload = JSON.parse(indexText);
  const conceptPayload = JSON.parse(conceptText);
  const summary = conceptPayload.summary || {};
  const complete = Number.isInteger(summary.candidateRecordCount)
    && summary.candidateRecordCount > 0
    && summary.publishedRecordCount === summary.candidateRecordCount
    && summary.excludedRecordCount === 0
    && !Object.keys(summary.exclusionCounts || {}).length;
  if (process.argv.includes("--if-ready") && !complete) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", reason: "concept-artifact-not-finalized" })}\n`);
    return;
  }
  const artifact = buildPeopleTopicsArtifact(indexPayload.records || [], conceptPayload);
  artifact.source.indexArtifactFingerprint = fingerprint(indexText);
  artifact.fingerprints = {
    artifact: fingerprint(JSON.stringify(artifact)),
    conceptArtifact: fingerprint(conceptText),
  };
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({ output: outputPath, summary: artifact.scopes.all.summary })}\n`);
}

await main();
