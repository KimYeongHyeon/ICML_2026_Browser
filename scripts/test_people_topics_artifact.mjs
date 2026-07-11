import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPeopleTopicsArtifact,
  parsePeopleTopicsArtifact,
} from "../docs/site/people-artifact.mjs";
import { buildAuthorNetworkFromAnalytics } from "../docs/site/people-analytics.mjs";

const records = [
  {
    id: "paper:1",
    type: "paper",
    title: "Sparse routing",
    authors: "Ada Lovelace, Grace Hopper",
    authorEmails: ["ada@example.org", ""],
  },
  {
    id: "paper:2",
    type: "paper",
    title: "Reliable routing",
    authors: "A. Lovelace, Grace Hopper",
    authorEmails: ["ADA@example.org", ""],
  },
];

const conceptFingerprint = `sha256:${"a".repeat(64)}`;
const indexFingerprint = `sha256:${"b".repeat(64)}`;
const peopleFingerprint = `sha256:${"c".repeat(64)}`;

const completeConceptArtifact = {
  schemaVersion: "icml-concepts/v1",
  fingerprints: { artifact: conceptFingerprint },
  records: {
    "paper:1": { core: ["Sparse expert routing"], detail: ["Load balancing"] },
    "paper:2": { core: ["Sparse expert routing"], detail: ["Failure recovery"] },
  },
  summary: {
    candidateRecordCount: 2,
    publishedRecordCount: 2,
    excludedRecordCount: 0,
    exclusionCounts: {},
  },
};

function publishedArtifact() {
  const artifact = buildPeopleTopicsArtifact(records, completeConceptArtifact, {
    indexVersion: "fixture-index-v1",
    indexArtifactFingerprint: indexFingerprint,
  });
  artifact.fingerprints = { artifact: peopleFingerprint, conceptArtifact: conceptFingerprint };
  return artifact;
}

test("buildPeopleTopicsArtifact rejects partial concept coverage", () => {
  // Given: extraction is still running and one candidate has not been published.
  const partial = {
    ...completeConceptArtifact,
    summary: {
      ...completeConceptArtifact.summary,
      publishedRecordCount: 1,
      excludedRecordCount: 1,
      exclusionCounts: { manifest_not_successful: 1 },
    },
  };

  // When / Then: no people or topic claims are emitted from incomplete coverage.
  assert.throws(
    () => buildPeopleTopicsArtifact(records, partial),
    /complete concept coverage is required/,
  );
});

test("buildPeopleTopicsArtifact rejects summary and record-count disagreement", () => {
  const inconsistent = { ...completeConceptArtifact, records: { "paper:1": completeConceptArtifact.records["paper:1"] } };
  assert.throws(() => buildPeopleTopicsArtifact(records, inconsistent), /complete concept coverage is required/);
});

test("buildPeopleTopicsArtifact resolves authors and publishes single-year prevalence", () => {
  // Given: every candidate has a finalized reviewed-concept entry.
  // When: the downstream analysis artifact is built.
  const artifact = publishedArtifact();

  // Then: identity, collaboration proxy, and corpus topic claims are explicit and bounded.
  assert.equal(artifact.schemaVersion, "icml-people-topics/v1");
  assert.equal(artifact.source.conceptArtifactFingerprint, conceptFingerprint);
  assert.equal(artifact.source.conceptRecordCount, 2);
  assert.equal(artifact.scopes.all.summary.authorCount, 2);
  const ada = artifact.scopes.all.authors.find((author) => author.name === "Ada Lovelace");
  assert.equal(ada?.paperCount, 2);
  assert.deepEqual(ada?.aliases, ["A. Lovelace", "Ada Lovelace"]);
  assert.equal(ada?.identityEvidence, "email");
  assert.equal("email" in ada, false);
  assert.equal(artifact.scopes.all.groups[0].provenance.kind, "coauthor-community-proxy");
  assert.equal(artifact.scopes.all.topicTrends.claimScope, "single-year-corpus-prevalence");
  assert.deepEqual(artifact.scopes.all.topicTrends.topics[0], {
    label: "Sparse expert routing",
    workCount: 2,
    workShare: 1,
  });
  assert.equal("growth" in artifact.scopes.all.topicTrends, false);
  assert.equal("change" in artifact.scopes.all.topicTrends, false);
});

test("parsePeopleTopicsArtifact rejects stale concept provenance", () => {
  // Given: an otherwise valid analysis artifact was built from an older concept revision.
  const artifact = publishedArtifact();

  // When / Then: the UI boundary refuses to combine revisions.
  assert.throws(
    () => parsePeopleTopicsArtifact(artifact, `sha256:${"d".repeat(64)}`, "fixture-index-v1", indexFingerprint, 2),
    /Invalid people and topic analysis artifact/,
  );
  assert.equal(
    parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v1", indexFingerprint, 2),
    artifact,
  );
});

test("parsePeopleTopicsArtifact requires complete concept and index provenance", () => {
  const artifact = publishedArtifact();
  assert.throws(() => parsePeopleTopicsArtifact(artifact), /Invalid people and topic analysis artifact/);
  assert.throws(() => parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v2", indexFingerprint, 2), /Invalid people and topic analysis artifact/);
  assert.throws(() => parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v1", `sha256:${"d".repeat(64)}`, 2), /Invalid people and topic analysis artifact/);
  assert.throws(() => parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v1", indexFingerprint, 3), /Invalid people and topic analysis artifact/);
  assert.equal(parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v1", indexFingerprint, 2), artifact);
});

test("parsePeopleTopicsArtifact rejects raw email data in any published field", () => {
  const artifact = publishedArtifact();
  artifact.scopes.all.authors[0].authorEmails = ["private@example.org"];
  assert.throws(
    () => parsePeopleTopicsArtifact(artifact, conceptFingerprint, "fixture-index-v1", indexFingerprint, 2),
    /Invalid people and topic analysis artifact/,
  );
});

test("buildAuthorNetworkFromAnalytics reuses the published people scope", () => {
  // Given: the browser has loaded the finalized precomputed scope.
  const artifact = publishedArtifact();

  // When: Author Map derives its graph view without re-resolving identities.
  const network = buildAuthorNetworkFromAnalytics(artifact.scopes.all);

  // Then: the recurring authors and collaboration edge preserve artifact identities.
  assert.deepEqual(network.nodes.map((node) => node.title), ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(network.links.length, 1);
  assert.equal(network.links[0].value, 2);
  assert.equal(network.summary.uniqueWorks, 2);
});
