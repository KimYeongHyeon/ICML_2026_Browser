import assert from "node:assert/strict";
import test from "node:test";

import {
  conceptsForRecord,
  parseConceptArtifact,
} from "../docs/site/research-concepts.mjs";

const artifact = {
  records: [
    {
      record_id: "paper-1",
      review_status: "accepted",
      core_concepts: ["Sparse expert routing", "Mixture-of-experts", "Third core", "Ignored"],
      detail_concepts: ["Load balancing", "Token dispatch", "Auxiliary loss", "Router jitter", "Capacity factor", "Expert parallelism", "Ignored"],
    },
    {
      record_id: "paper-2",
      review_status: "accepted",
      core_concepts: ["Machine Learning"],
      detail_concepts: ["Deep Learning"],
    },
    {
      record_id: "paper-3",
      review_status: "needs_review",
      core_concepts: ["Concrete but unreviewed"],
      detail_concepts: ["Detail"],
    },
  ],
};

test("parseConceptArtifact keeps only concrete accepted concepts at display limits", () => {
  // Given: the published artifact contains valid concepts, oversized arrays, and broad labels.
  // When: it crosses the browser boundary.
  const concepts = parseConceptArtifact(artifact);

  // Then: the UI receives only concrete, accepted Core and Detail concepts.
  assert.deepEqual(conceptsForRecord(concepts, "paper-1"), {
    core: ["Sparse expert routing", "Mixture-of-experts", "Third core"],
    detail: ["Load balancing", "Token dispatch", "Auxiliary loss", "Router jitter", "Capacity factor", "Expert parallelism"],
  });
  assert.deepEqual(conceptsForRecord(concepts, "paper-2"), { core: [], detail: [] });
  assert.deepEqual(conceptsForRecord(concepts, "paper-3"), { core: [], detail: [] });
});

test("parseConceptArtifact fails closed for missing or empty artifacts", () => {
  // Given: concept data is unavailable or empty.
  // When: the UI asks for a record's concepts.
  // Then: no embedding domain is substituted as a research concept.
  assert.deepEqual(conceptsForRecord(parseConceptArtifact(null), "paper-1"), { core: [], detail: [] });
  assert.deepEqual(conceptsForRecord(parseConceptArtifact({ records: [] }), "paper-1"), { core: [], detail: [] });
});

test("parseConceptArtifact reads the published compact v1 record mapping", () => {
  // Given: the compiler's published compact artifact maps record ids to Core and Detail values.
  const compactArtifact = {
    schema_version: 1,
    metadata: { generated_at: "2026-07-11T00:00:00Z" },
    records: {
      "paper-compact": {
        core: ["Sparse expert routing", "Mixture-of-experts"],
        detail: ["Load balancing", "Token dispatch"],
      },
    },
  };

  // When: the browser parses the published artifact.
  const concepts = parseConceptArtifact(compactArtifact);

  // Then: the compact Core and Detail values are available without model-output fields.
  assert.deepEqual(conceptsForRecord(concepts, "paper-compact"), {
    core: ["Sparse expert routing", "Mixture-of-experts"],
    detail: ["Load balancing", "Token dispatch"],
  });
});
