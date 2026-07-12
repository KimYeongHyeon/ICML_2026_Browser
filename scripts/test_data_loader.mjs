import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const siteDirectory = new URL("../docs/site/", import.meta.url);

async function withDataLoader(action) {
  const directory = await mkdtemp(join(tmpdir(), "icml-data-loader-test-"));
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  const cryptoWasInjected = !globalThis.crypto?.subtle;
  globalThis.window = { location: { pathname: "/" } };
  if (cryptoWasInjected) globalThis.crypto = webcrypto;
  try {
    const [config, loader, concepts, peopleArtifact, peopleAnalytics, coreTopics] = await Promise.all([
      readFile(new URL("config.js", siteDirectory), "utf8"),
      readFile(new URL("data-loader.js", siteDirectory), "utf8"),
      readFile(new URL("research-concepts.mjs", siteDirectory), "utf8"),
      readFile(new URL("people-artifact.mjs", siteDirectory), "utf8"),
      readFile(new URL("people-analytics.mjs", siteDirectory), "utf8"),
      readFile(new URL("core-topics.mjs", siteDirectory), "utf8"),
    ]);
    await Promise.all([
      writeFile(join(directory, "config.mjs"), config),
      writeFile(join(directory, "research-concepts.mjs"), concepts),
      writeFile(join(directory, "people-artifact.mjs"), peopleArtifact),
      writeFile(join(directory, "people-analytics.mjs"), peopleAnalytics),
      writeFile(join(directory, "core-topics.mjs"), coreTopics),
      writeFile(
        join(directory, "data-loader.mjs"),
        loader.replace('"./config.js"', '"./config.mjs"'),
      ),
    ]);
    const module = await import(pathToFileURL(join(directory, "data-loader.mjs")).href);
    return await action(module);
  } finally {
    globalThis.window = originalWindow;
    if (cryptoWasInjected) globalThis.crypto = originalCrypto;
    await rm(directory, { force: true, recursive: true });
  }
}

async function withFetch(fetchImplementation, action) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function peopleTopicsResponse(body) {
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

function fingerprint(body) {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function validPeopleTopicsPayload() {
  return {
    schemaVersion: "icml-people-topics/v1",
    source: {
      conceptArtifactFingerprint: `sha256:${"a".repeat(64)}`,
      conceptRecordCount: 7065,
      indexVersion: "fixture-version",
      indexArtifactFingerprint: `sha256:${"b".repeat(64)}`,
    },
    fingerprints: { artifact: `sha256:${"c".repeat(64)}`, conceptArtifact: `sha256:${"a".repeat(64)}` },
    scopes: Object.fromEntries(["all", "main", "workshop"].map((scope) => [scope, {
      summary: {},
      identityResolution: { emailAddressesPublished: false },
      authors: [],
      coauthorLinks: [],
      groups: [],
      topicTrends: { claimScope: "single-year-corpus-prevalence", topics: [] },
    }])),
  };
}

test("loadResearchConcepts rejects a missing published artifact", { concurrency: false }, async () => {
  // Given: the published concept artifact responds with a missing status.
  await withDataLoader(async ({ loadResearchConcepts }) => withFetch(async () => ({ ok: false, status: 404 }), async () => {
    // When: the application loads reviewed research concepts.
    await assert.rejects(
      loadResearchConcepts("fixture-version"),
      /Failed to load .*icml2026_concepts\.json.*\(404\)/,
    );
  }));
});

test("loadResearchConcepts rejects an artifact without the published schema", { concurrency: false }, async () => {
  // Given: a response is JSON but does not have the compiled artifact contract.
  await withDataLoader(async ({ loadResearchConcepts }) => withFetch(async () => ({ ok: true, json: async () => ({ records: [] }) }), async () => {
    // When: the application parses the artifact boundary.
    await assert.rejects(
      loadResearchConcepts("fixture-version"),
      /Invalid research concepts artifact/,
    );
  }));
});

test("loadResearchConcepts rejects a concept-count mismatch", { concurrency: false }, async () => {
  // Given: the artifact claims a reviewed concept record that the compact map omits.
  const payload = {
    schemaVersion: "icml-concepts/v1",
    fingerprints: { artifact: `sha256:${"a".repeat(64)}` },
    records: {},
    summary: { publishedRecordCount: 1 },
  };
  await withDataLoader(async ({ loadResearchConcepts }) => withFetch(async () => ({ ok: true, json: async () => payload }), async () => {
    // When: the application validates the published artifact.
    await assert.rejects(
      loadResearchConcepts("fixture-version"),
      /Invalid research concepts artifact/,
    );
  }));
});

test("loadResearchConcepts returns reviewed concepts from a valid published artifact", { concurrency: false }, async () => {
  // Given: a compact artifact emitted by the compiler.
  const payload = {
    schemaVersion: "icml-concepts/v1",
    fingerprints: { artifact: `sha256:${"a".repeat(64)}` },
    records: {
      "paper-1": {
        core: ["Concept erasure"],
        detail: ["Activation steering"],
      },
    },
    summary: { publishedRecordCount: 1 },
  };
  await withDataLoader(async ({ loadResearchConcepts }) => withFetch(async () => ({ ok: true, json: async () => payload }), async () => {
    // When: the application loads research concepts.
    const concepts = await loadResearchConcepts("fixture-version");

    // Then: the accepted compact concepts reach the application unchanged.
    assert.deepEqual(concepts.get("paper-1"), {
      core: ["Concept erasure"],
      detail: ["Activation steering"],
    });
  }));
});

test("loadPeopleTopics accepts only the exact manifest-pinned bytes", { concurrency: false }, async () => {
  // Given: the published analysis body exactly matches the manifest hash.
  const payload = validPeopleTopicsPayload();
  const body = JSON.stringify(payload);
  await withDataLoader(async ({ loadPeopleTopics }) => withFetch(async () => peopleTopicsResponse(body), async () => {
    // When: the loader verifies raw response bytes before parsing JSON.
    assert.deepEqual(
      await loadPeopleTopics("fixture-version", `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, 7065, fingerprint(body)),
      payload,
    );
  }));
});

test("loadPeopleTopics rejects a valid-shaped body whose raw bytes differ from the manifest pin", { concurrency: false }, async () => {
  // Given: a still-valid artifact body has been changed after the manifest hash was published.
  const body = JSON.stringify(validPeopleTopicsPayload());
  const tamperedBody = JSON.stringify({ ...validPeopleTopicsPayload(), audit: "tampered" });
  await withDataLoader(async ({ loadPeopleTopics }) => withFetch(async () => peopleTopicsResponse(tamperedBody), async () => {
    // When / Then: JSON parsing is never trusted before the byte fingerprint matches.
    await assert.rejects(
      loadPeopleTopics("fixture-version", `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, 7065, fingerprint(body)),
      /People topics artifact fingerprint mismatch/,
    );
  }));
});

test("loadPeopleTopics fails closed when the manifest pin is missing or malformed", { concurrency: false }, async () => {
  // Given: the current index manifest has no trustworthy people-artifact fingerprint.
  for (const expectedFingerprint of ["", "sha256:not-a-digest"]) {
    let fetched = false;
    await withDataLoader(async ({ loadPeopleTopics }) => withFetch(async () => {
      fetched = true;
      return peopleTopicsResponse(JSON.stringify(validPeopleTopicsPayload()));
    }, async () => {
      // When / Then: the loader rejects the missing or malformed pin before fetching data.
      await assert.rejects(
        loadPeopleTopics("fixture-version", `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, 7065, expectedFingerprint),
        /Invalid people topics artifact fingerprint/,
      );
      assert.equal(fetched, false);
    }));
  }
});
