import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorNetwork,
  buildPeopleAnalytics,
  parseAuthors,
} from "../docs/site/people-analytics.mjs";

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
