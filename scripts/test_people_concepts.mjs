import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthorNetwork, buildPeopleAnalytics } from "../docs/site/people-analytics.mjs";

const reviewedRecord = {
  id: "paper-1",
  type: "paper",
  title: "Routing sparse experts",
  authors: "Ada Lovelace, Grace Hopper",
  areaTags: ["Systems"],
  researchConcepts: {
    core: ["Sparse expert routing", "Mixture-of-experts"],
    detail: ["Load balancing", "Token dispatch", "Auxiliary loss", "Router jitter", "Capacity factor", "Expert parallelism"],
  },
};

test("People and Author Map aggregate only the primary reviewed Core concept", () => {
  // Given: a work has multiple reviewed Core concepts and an unrelated broad area.
  // When: people and author-map aggregates are calculated.
  const people = buildPeopleAnalytics([reviewedRecord]);
  const network = buildAuthorNetwork([reviewedRecord], { minWorks: 1 });

  // Then: each aggregate uses the first Core concept, never the broad area or a second Core.
  assert.deepEqual(people.authors[0].topics, [{ label: "Sparse expert routing", count: 1 }]);
  assert.equal(network.nodes[0].group, "Sparse expert routing");
});

test("People concepts fail closed instead of falling back to a broad domain", () => {
  // Given: a work has no reviewed concept artifact entry.
  // When: aggregate concepts are calculated.
  const people = buildPeopleAnalytics([{ ...reviewedRecord, researchConcepts: { core: [], detail: [] } }]);

  // Then: Systems is not presented as a research concept.
  assert.deepEqual(people.authors[0].topics, []);
});
