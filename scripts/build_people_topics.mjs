import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPeopleTopicsArtifact } from "../docs/site/people-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : resolve(root, fallback);
}

function numericOption(name, fallback) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive integer.`);
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function containsPrivateEmail(value) {
  if (Array.isArray(value)) return value.some(containsPrivateEmail);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, nested]) => (
      key === "email" || key === "authorEmails" || containsPrivateEmail(nested)
    ));
  }
  return typeof value === "string" && /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u.test(value);
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node scripts/build_people_topics.mjs [--index PATH] [--concepts PATH] [--output PATH] [--manifest PATH] [--expected-records N] [--if-ready]\n");
    return;
  }
  const indexPath = option("--index", "docs/site/data/icml2026_index.json");
  const conceptPath = option("--concepts", "docs/site/data/concepts/icml2026_concepts.json");
  const outputPath = option("--output", "docs/site/data/analysis/icml2026_people_topics.json");
  const manifestPath = option("--manifest", "docs/site/data/icml2026_index.manifest.json");
  const expectedRecordCount = numericOption("--expected-records", 7065);
  const [indexText, conceptText] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(conceptPath, "utf8"),
  ]);
  const indexPayload = JSON.parse(indexText);
  const conceptPayload = JSON.parse(conceptText);
  const summary = conceptPayload.summary || {};
  const complete = Number.isInteger(summary.candidateRecordCount)
    && summary.candidateRecordCount === expectedRecordCount
    && summary.publishedRecordCount === summary.candidateRecordCount
    && summary.excludedRecordCount === 0
    && !Object.keys(summary.exclusionCounts || {}).length;
  if (process.argv.includes("--if-ready") && !complete) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", reason: "concept-artifact-not-finalized" })}\n`);
    return;
  }
  if (!complete) throw new Error(`Expected a finalized ${expectedRecordCount.toLocaleString()}-record concept artifact.`);
  if (!indexPayload.generatedAt) throw new Error("The index artifact requires generatedAt provenance.");
  const indexArtifactFingerprint = fingerprint(indexText);
  const artifact = buildPeopleTopicsArtifact(indexPayload.records || [], conceptPayload, {
    indexVersion: indexPayload.generatedAt,
    indexArtifactFingerprint,
  });
  artifact.fingerprints = {
    artifact: fingerprint(JSON.stringify(artifact)),
    conceptArtifact: fingerprint(conceptText),
  };
  if (containsPrivateEmail(artifact)) throw new Error("Refusing to publish an analysis artifact containing email addresses.");
  const serializedArtifact = `${JSON.stringify(artifact)}\n`;
  const peopleTopicsArtifactFingerprint = fingerprint(serializedArtifact);
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, serializedArtifact, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, outputPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The index manifest must be a JSON object.");
  }
  manifest.peopleTopicsArtifactFingerprint = peopleTopicsArtifactFingerprint;
  const temporaryManifestPath = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryManifestPath, manifestPath);
  process.stdout.write(`${JSON.stringify({ output: outputPath, summary: artifact.scopes.all.summary })}\n`);
}

await main();
