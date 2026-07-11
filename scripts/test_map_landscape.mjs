import assert from "node:assert/strict";
import test from "node:test";
import { matchesLandscapeCluster } from "../docs/site/map-landscape.mjs";

test("matchesLandscapeCluster keeps only the selected base embedding cluster", () => {
  const selected = { id: "a", embeddingClusterId: "cluster-7" };
  const other = { id: "b", embeddingClusterId: "cluster-8" };

  assert.equal(matchesLandscapeCluster(selected, "cluster-7"), true);
  assert.equal(matchesLandscapeCluster(other, "cluster-7"), false);
});

test("matchesLandscapeCluster does not filter when no landscape is selected", () => {
  assert.equal(matchesLandscapeCluster({ embeddingClusterId: "cluster-7" }, ""), true);
});
