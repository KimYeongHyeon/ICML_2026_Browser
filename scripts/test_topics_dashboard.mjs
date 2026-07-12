import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { pathname: "" } };
const { buildReviewedTopicIndex, matchesConceptSearch } = await import("../docs/site/topics-dashboard.mjs");

test("buildReviewedTopicIndex keeps exact reviewed Core concepts and deduplicates poster copies", () => {
  const index = buildReviewedTopicIndex([
    {
      id: "paper:1",
      type: "paper",
      title: "Erasing Concepts",
      researchConcepts: { core: ["Concept erasure", "Orthogonal projections"] },
    },
    {
      id: "poster:1",
      type: "poster",
      title: "Erasing Concepts",
      researchConcepts: { core: ["Concept erasure"] },
    },
    {
      id: "paper:2",
      type: "paper",
      title: "ODE Guidance",
      researchConcepts: { core: ["Ordinary Differential Equation", "Concept erasure"] },
    },
  ]);

  assert.equal(index.workCount, 2);
  assert.deepEqual(
    index.topics.map(({ label, workCount }) => ({ label, workCount })),
    [
      { label: "Concept erasure", workCount: 2 },
      { label: "Ordinary Differential Equation", workCount: 1 },
      { label: "Orthogonal projections", workCount: 1 },
    ],
  );
});

test("buildReviewedTopicIndex does not collapse unrelated natural-language titles", () => {
  const index = buildReviewedTopicIndex([
    { id: "paper:alpha", type: "paper", title: "Orthogonal Concept Erasure for Diffusion Models", researchConcepts: { core: ["Concept erasure"] } },
    { id: "paper:beta", type: "paper", title: "Z-Erase: Enabling Concept Erasure in Single Stream Diffusion Transformers", researchConcepts: { core: ["Concept erasure"] } },
  ]);

  assert.equal(index.workCount, 2);
  assert.deepEqual(index.topics.map((topic) => ({ label: topic.label, workCount: topic.workCount })), [{ label: "Concept erasure", workCount: 2 }]);
});

test("Core concept search matches ODE tokens without matching autoencoders", () => {
  assert.equal(matchesConceptSearch("Ordinary Differential Equation (ODE)", "ODE"), true);
  assert.equal(matchesConceptSearch("Sparse Autoencoders", "ODE"), false);
  assert.equal(matchesConceptSearch("Orthogonal Concept Erasure", "concept erasure"), true);
});
