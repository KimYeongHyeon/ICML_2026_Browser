import assert from "node:assert/strict";
import test from "node:test";

globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { location: { pathname: "" } };

const { getFilteredRecords } = await import("../docs/site/browse.js");
const { clearMapCoreConceptFilter, createMapCoreConceptHandoff } = await import("../docs/site/map-core-concept-filter.mjs");
const { matchesMapCoreConcept } = await import("../docs/site/research-concepts.mjs");
const { state } = await import("../docs/site/state.js");

test("Given a selected Core concept, when map records are filtered, then only exact Core members remain", () => {
  const selectedConcept = "Mechanistic interpretability";
  const matchingWithoutText = {
    title: "Circuit discovery in transformer models",
    abstract: "We study sparse computational pathways.",
    researchConcepts: { core: [selectedConcept] },
  };
  const textOnlyMatch = {
    title: "Mechanistic interpretability for language models",
    abstract: "A title-only mention should not qualify this record.",
    researchConcepts: { core: ["Sparse autoencoders"] },
  };

  assert.equal(matchesMapCoreConcept(matchingWithoutText, selectedConcept), true);
  assert.equal(matchesMapCoreConcept(textOnlyMatch, selectedConcept), false);
});

test("Given a selected Core concept, when it appears only as Detail, then the record is excluded", () => {
  const selectedConcept = "Mechanistic interpretability";
  const detailOnlyMatch = {
    researchConcepts: {
      core: ["Sparse autoencoders"],
      detail: [selectedConcept],
    },
  };

  assert.equal(matchesMapCoreConcept(detailOnlyMatch, selectedConcept), false);
});

test("Given an active Map Core filter, when browse records are collected, then text-only records are excluded", () => {
  const selectedConcept = "Mechanistic interpretability";
  const matchingWithoutText = {
    id: "core-member",
    type: "paper",
    title: "Circuit discovery in transformer models",
    abstract: "We study sparse computational pathways.",
    researchConcepts: { core: [selectedConcept] },
  };
  const textOnlyMatch = {
    id: "text-only",
    type: "paper",
    title: "Mechanistic interpretability for language models",
    abstract: "A title-only mention should not qualify this record.",
    researchConcepts: { core: ["Sparse autoencoders"] },
  };
  const previousState = {
    data: state.data,
    tab: state.tab,
    query: state.query,
    category: state.category,
    group: state.group,
    presentation: state.presentation,
    mapCoreConceptFilter: state.mapCoreConceptFilter,
    mapFilterValue: state.mapFilterValue,
    mapLandscapeFilterId: state.mapLandscapeFilterId,
  };

  try {
    Object.assign(state, {
      data: { records: [matchingWithoutText, textOnlyMatch] },
      tab: "map",
      query: "",
      category: "all",
      group: "all",
      presentation: "all",
      mapCoreConceptFilter: selectedConcept,
      mapFilterValue: "",
      mapLandscapeFilterId: "",
    });

    assert.deepEqual(getFilteredRecords().map((record) => record.id), ["core-member"]);
  } finally {
    Object.assign(state, previousState);
  }
});

test("Given a Map landscape filter, when legend records ignore the color filter, then the landscape and Core filters remain active", () => {
  const selectedConcept = "Mechanistic interpretability";
  const records = [
    { id: "matching", type: "paper", clusterLabel: "Optimization", embeddingClusterId: "cluster-7", researchConcepts: { core: [selectedConcept] } },
    { id: "wrong-color", type: "paper", clusterLabel: "Vision", embeddingClusterId: "cluster-7", researchConcepts: { core: [selectedConcept] } },
    { id: "wrong-landscape", type: "paper", clusterLabel: "Optimization", embeddingClusterId: "cluster-8", researchConcepts: { core: [selectedConcept] } },
    { id: "wrong-core", type: "paper", clusterLabel: "Optimization", embeddingClusterId: "cluster-7", researchConcepts: { core: ["Sparse autoencoders"] } },
  ];
  const previousState = {
    data: state.data,
    tab: state.tab,
    query: state.query,
    category: state.category,
    group: state.group,
    presentation: state.presentation,
    mapCoreConceptFilter: state.mapCoreConceptFilter,
    mapFilterValue: state.mapFilterValue,
    mapLandscapeFilterId: state.mapLandscapeFilterId,
  };

  try {
    Object.assign(state, {
      data: { records },
      tab: "map",
      query: "",
      category: "all",
      group: "all",
      presentation: "all",
      mapCoreConceptFilter: selectedConcept,
      mapFilterValue: "Optimization",
      mapLandscapeFilterId: "cluster-7",
    });

    assert.deepEqual(getFilteredRecords({ ignoreMapFilter: true }).map((record) => record.id), ["matching", "wrong-color"]);
  } finally {
    Object.assign(state, previousState);
  }
});

test("Given a People Core-concept action, when preparing the Map handoff, then the exact filter is set without a text query", () => {
  const handoff = createMapCoreConceptHandoff("Mechanistic interpretability");

  assert.deepEqual(handoff, {
    tab: "map",
    query: "",
    selectedId: "",
    mapCoreConceptFilter: "Mechanistic interpretability",
  });
});

test("Given active Map color and landscape filters, when clearing the Core filter, then those Map filters remain", () => {
  const mapState = {
    mapCoreConceptFilter: "Mechanistic interpretability",
    mapFilterValue: "Optimization",
    mapLandscapeFilterId: "embedding-cluster-007",
    mapLandscapeFilterName: "Cluster 07",
  };

  clearMapCoreConceptFilter(mapState);

  assert.deepEqual(mapState, {
    mapCoreConceptFilter: "",
    mapFilterValue: "Optimization",
    mapLandscapeFilterId: "embedding-cluster-007",
    mapLandscapeFilterName: "Cluster 07",
  });
});
