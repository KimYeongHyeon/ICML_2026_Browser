import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorNetwork,
  buildPeopleAnalytics,
  parseAuthors,
} from "../docs/site/people-analytics.mjs";

globalThis.window = { location: { pathname: "" } };
const {
  buildAuthorMapComponents,
  filterAuthorGraph,
  selectAuthorMapIslands,
} = await import("../docs/site/author-map.mjs");

test("parseAuthors handles collected author separators", () => {
  // Given: author strings from the ICML and workshop collectors.
  // When: the strings are parsed.
  // Then: whitespace is normalized without splitting a person's name.
  assert.deepEqual(parseAuthors("Ada Lovelace ⋅ Grace Hopper, Alan Turing"), [
    "Ada Lovelace",
    "Grace Hopper",
    "Alan Turing",
  ]);
});

test("buildPeopleAnalytics deduplicates paper and poster records", () => {
  // Given: one work represented by both paper and poster records.
  const records = [
    { id: "paper:1", type: "paper", title: "Shared Work", authors: "Ada Lovelace, Grace Hopper", areaTags: ["Systems"] },
    { id: "poster:1", type: "poster", title: "Shared Work", authors: "Ada Lovelace ⋅ Grace Hopper", areaTags: ["Systems"] },
    { id: "paper:2", type: "paper", title: "Second Work", authors: "Ada Lovelace, Grace Hopper", areaTags: ["Optimization"] },
  ];

  // When: people analytics are built.
  const analytics = buildPeopleAnalytics(records);

  // Then: output counts unique works and finds a repeated collaboration group.
  assert.equal(analytics.summary.uniqueWorks, 2);
  assert.equal(analytics.authors[0].name, "Ada Lovelace");
  assert.equal(analytics.authors[0].paperCount, 2);
  assert.deepEqual(analytics.authors[0].topics, [
    { label: "Optimization", count: 1 },
    { label: "Systems", count: 1 },
  ]);
  assert.equal(analytics.groups.length, 1);
  assert.deepEqual(analytics.groups[0].members, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(analytics.groups[0].paperCount, 2);
});

test("buildPeopleAnalytics prioritizes one semantic core topic over fixed area labels", () => {
  const analytics = buildPeopleAnalytics([
    {
      id: "1",
      type: "paper",
      title: "Routing Sparse Experts",
      authors: "Ada Lovelace, Grace Hopper",
      areaTags: ["Systems"],
      embeddingClusterKeywords: ["mixture-of-experts", "routing", "training"],
    },
  ]);

  assert.deepEqual(analytics.authors[0].topics, [{ label: "mixture-of-experts", count: 1 }]);
});

test("buildPeopleAnalytics keeps one-off coauthors out of lab proxies", () => {
  // Given: no author pair appears on two works.
  const records = [
    { id: "1", type: "paper", title: "One", authors: "A One, B Two", areaTags: ["Vision"] },
    { id: "2", type: "paper", title: "Two", authors: "A One, C Three", areaTags: ["LLMs"] },
  ];

  // When: collaboration groups are inferred.
  const analytics = buildPeopleAnalytics(records);

  // Then: no group is presented as a stable research-group proxy.
  assert.deepEqual(analytics.groups, []);
});

test("buildPeopleAnalytics merges renamed authors by email", () => {
  // Given: one person publishes under two name variants with the same email.
  const records = [
    {
      id: "1",
      type: "paper",
      title: "One",
      authors: "Ada Lovelace, B Two",
      authorEmails: ["ada@example.org", ""],
      areaTags: ["Vision"],
    },
    {
      id: "2",
      type: "paper",
      title: "Two",
      authors: "A. Lovelace, C Three",
      authorEmails: ["ADA@example.org", ""],
      areaTags: ["LLMs"],
    },
  ];

  // When: identities are resolved.
  const analytics = buildPeopleAnalytics(records);

  // Then: normalized email is the strongest unique-person key.
  const ada = analytics.authors.find((author) => author.email === "ada@example.org");
  assert.equal(ada?.paperCount, 2);
  assert.deepEqual(ada?.aliases, ["A. Lovelace", "Ada Lovelace"]);
});

test("buildPeopleAnalytics separates same-name authors without shared context", () => {
  // Given: the same display name occurs in disconnected coauthor neighborhoods.
  const records = [
    { id: "1", type: "paper", title: "One", authors: "J. Lee, B Two", areaTags: ["Vision"] },
    { id: "2", type: "paper", title: "Two", authors: "J. Lee, C Three", areaTags: ["LLMs"] },
  ];

  // When: identities are resolved without email evidence.
  const analytics = buildPeopleAnalytics(records);

  // Then: the ambiguous name remains two identities instead of a false merge.
  assert.equal(analytics.authors.filter((author) => author.name === "J. Lee").length, 2);
});

test("buildPeopleAnalytics keeps conflicting email identities separate", () => {
  const records = [
    { id: "1", type: "paper", title: "One", authors: "Sam Lee, Shared Person", authorEmails: ["sam-a@example.org", "shared@example.org"] },
    { id: "2", type: "paper", title: "Two", authors: "Sam Lee, Shared Person", authorEmails: ["sam-b@example.org", "shared@example.org"] },
  ];
  const analytics = buildPeopleAnalytics(records);
  assert.equal(analytics.authors.filter((author) => author.name === "Sam Lee").length, 2);
});

test("buildPeopleAnalytics prevents an email-less alias from bridging conflicting emails", () => {
  // Given: an ambiguous same-name occurrence shares a coauthor with two distinct email-backed people.
  const records = [
    { id: "1", type: "paper", title: "One", authors: "Sam Lee, Shared Person", authorEmails: ["sam-a@example.org", "shared@example.org"] },
    { id: "2", type: "paper", title: "Two", authors: "Sam Lee, Shared Person", authorEmails: ["", "shared@example.org"] },
    { id: "3", type: "paper", title: "Three", authors: "Sam Lee, Shared Person", authorEmails: ["sam-b@example.org", "shared@example.org"] },
  ];

  // When: identities are resolved through their overlapping coauthor context.
  const analytics = buildPeopleAnalytics(records);

  // Then: the email-less alias cannot transitively merge the two verified identities.
  assert.equal(analytics.authors.filter((author) => author.name === "Sam Lee").length, 2);
  assert.deepEqual(
    analytics.authors.filter((author) => author.name === "Sam Lee").map((author) => author.paperCount).sort(),
    [1, 2],
  );
});

test("buildPeopleAnalytics emits stable identity IDs across input order", () => {
  const records = [
    { id: "paper:b", type: "paper", title: "Beta", authors: "Bob B" },
    { id: "paper:a", type: "paper", title: "Alpha", authors: "Ada A" },
  ];
  const first = buildPeopleAnalytics(records);
  const second = buildPeopleAnalytics(records.slice().reverse());
  assert.deepEqual(first.authors.map(({ identityId, name }) => ({ identityId, name })), second.authors.map(({ identityId, name }) => ({ identityId, name })));
});

test("buildAuthorNetwork keeps recurring authors and weights coauthor links", () => {
  // Given: two recurring collaborators and one one-off collaborator.
  const records = [
    { id: "1", type: "paper", title: "One", authors: "Ada Lovelace, Grace Hopper", areaTags: ["Systems"] },
    { id: "2", type: "paper", title: "Two", authors: "Ada Lovelace, Grace Hopper", areaTags: ["Systems"] },
    { id: "3", type: "paper", title: "Three", authors: "Ada Lovelace, Alan Turing", areaTags: ["Theory"] },
  ];

  // When: the author map receives its default recurring-author network.
  const network = buildAuthorNetwork(records);

  // Then: one-off authors are excluded, while the recurring link carries its work count.
  assert.deepEqual(network.nodes.map((node) => node.title), ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(network.links.length, 1);
  assert.equal(network.links[0].value, 2);
  assert.deepEqual(network.neighborsById.get(network.nodes[0].id), [{ id: network.nodes[1].id, workCount: 2 }]);
  assert.equal(network.insights.prolificAuthor.name, "Ada Lovelace");
  assert.deepEqual(network.insights.strongestPair, { source: "Ada Lovelace", target: "Grace Hopper", workCount: 2 });
  assert.deepEqual(network.insights.leadingTopic, { label: "Systems", authorCount: 2 });
});

test("filterAuthorGraph retains links after ForceGraph resolves endpoint nodes", () => {
  // Given: ForceGraph has replaced the graph's original string endpoints with nodes.
  const ada = { id: "ada", title: "Ada Lovelace", group: "Systems", topics: [] };
  const grace = { id: "grace", title: "Grace Hopper", group: "Systems", topics: [] };
  const network = {
    summary: { authorCount: 2, linkCount: 1 },
    nodes: [ada, grace],
    links: [{ source: ada, target: grace, value: 2 }],
    neighborsById: new Map([
      ["ada", [{ id: "grace", workCount: 2 }]],
      ["grace", [{ id: "ada", workCount: 2 }]],
    ]),
  };

  // When: the user searches for a mapped author.
  const filtered = filterAuthorGraph(network, "Ada");

  // Then: the adjacent coauthor link remains visible.
  assert.equal(filtered.summary.linkCount, 1);
  assert.equal(filtered.links.length, 1);
});

test("author map separates connected components and hides small islands by default", () => {
  const network = {
    summary: { authorCount: 6, linkCount: 3 },
    nodes: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: id, group: "Topic", topics: [] })),
    links: [
      { source: "a", target: "b", value: 2 },
      { source: "b", target: "c", value: 1 },
      { source: "d", target: "e", value: 1 },
    ],
    neighborsById: new Map(),
  };

  const components = buildAuthorMapComponents(network);
  const islands = selectAuthorMapIslands(network, 3);

  assert.deepEqual(components.map((component) => component.nodeIds.length), [3, 2, 1]);
  assert.deepEqual(islands.nodes.map((node) => node.id).sort(), ["a", "b", "c"]);
  assert.equal(islands.summary.islandCount, 1);
  assert.equal(islands.summary.hiddenAuthorCount, 3);
});
