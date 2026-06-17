# ICML 2026 Embedding Map Design

## Summary

Build an offline-generated semantic paper map for the ICML 2026 Materials Browser.

The feature adds:

- A dedicated `Map` tab for broad semantic exploration.
- A related-papers mini map in the selected record viewer.
- Separate `areaTags` and `domainTags` fields.
- Scientific-paper embeddings from a local SPECTER/SPECTER2-style model.
- 2D and 3D coordinates, nearest neighbors, clusters, and text-quality metadata.

The implementation must keep GitHub Pages static. Embedding, clustering, and map generation happen offline in scripts, then export static JSON for the browser.

## Evidence And Common Practice

The design follows the common literature-map workflow:

- Combine paper title and abstract as document text when available.
- Embed documents into a semantic vector space.
- Use cosine similarity for related-paper search.
- Project vectors into 2D/3D with UMAP or similar dimensionality reduction.
- Cluster embedded documents and attach human-readable topic labels.

Relevant references:

- SPECTER: document-level scientific paper embeddings trained with citation-informed signals: <https://arxiv.org/abs/2004.07180>
- SPECTER2: scientific embedding adaptation across tasks and fields: <https://allenai.org/blog/specter2-adapting-scientific-document-embeddings-to-multiple-fields-and-task-formats-c95686c06567>
- BERTopic pipeline: embeddings, UMAP, HDBSCAN, c-TF-IDF labels: <https://bertopic.com/>
- BERTopic best practice to precompute embeddings: <https://maartengr.github.io/BERTopic/getting_started/best_practices/best_practices.html>
- UMAP document embedding guidance: <https://umap-learn.readthedocs.io/en/latest/document_embedding.html>

## Data Pipeline

Each visible browser record gets an embedding input payload:

- `title`
- `abstract`, when available
- official `topic`, `group`, workshop name, or venue fallback
- record type context, such as poster or workshop

Missing abstracts do not block map inclusion. Instead, each record receives an `embeddingTextQuality` value:

- `title_abstract`: title plus abstract was available
- `title_topic`: title plus topic/group fallback was available
- `title_only`: only title-level text was available
- `unavailable`: record could not be embedded and must include a reason

The offline build creates:

- local scientific embeddings
- UMAP 2D coordinates
- UMAP 3D coordinates
- cosine nearest neighbors
- semantic clusters
- cluster labels
- controlled area/domain tags

Embedding cache keys must include:

- stable record id
- embedding input text hash
- model id/version

Raw vectors should remain in a local cache unless there is a concrete reason to ship them. The site should consume compact map metadata instead.

## Taxonomy

Use two controlled tag families.

`areaTags` describe the ML method or research area:

- LLMs
- Reinforcement Learning
- Vision
- Optimization
- Theory
- Systems
- Safety
- Generative Models
- Agents
- Evaluation
- Multimodal Learning
- Probabilistic Methods

`domainTags` describe the application domain:

- Biology
- Medical
- Climate
- Robotics
- Chemistry
- Materials
- Education
- Social Science
- Finance
- Scientific Discovery

Embedding-derived clusters do not replace the controlled taxonomy. Clusters provide semantic neighborhoods for discovery and map coloring.

Each record with `mapAvailable: true` must include:

- `areaTags`
- `domainTags`
- `clusterId`
- `clusterLabel`
- `classificationConfidence`
- `classificationReason`

The first implementation should prefer conservative multi-label assignment over forced single-label classification.

## Static Data Interfaces

Keep the existing `docs/site/data/icml2026_index.json` as the primary browser record index and add semantic fields to every visible record. Use empty arrays, `null`, or `false` when semantic data is unavailable:

- `areaTags`
- `domainTags`
- `clusterId`
- `clusterLabel`
- `embeddingTextQuality`
- `mapAvailable`

Add a separate `docs/site/data/icml2026_map.json` for map-heavy metadata:

```json
{
  "generatedAt": "ISO timestamp",
  "model": {
    "id": "local scientific embedding model id",
    "kind": "specter-like",
    "dimension": 768
  },
  "projection": {
    "method": "umap",
    "randomSeed": 42
  },
  "records": [
    {
      "id": "record id",
      "x": 0.12,
      "y": -0.34,
      "z": 0.56,
      "clusterId": "cluster-001",
      "nearestNeighbors": [
        {"id": "other-record-id", "score": 0.91}
      ]
    }
  ],
  "clusters": [
    {
      "id": "cluster-001",
      "label": "Retrieval-augmented agents",
      "size": 124,
      "topTerms": ["retrieval", "agent", "reasoning"]
    }
  ]
}
```

The browser must tolerate missing map data. A record without map metadata should remain visible in list/search views and show a clear unavailable reason in map-specific UI.

## UI Design

Add a dedicated `Map` tab.

Map tab layout:

- left controls: search, area, domain, cluster, group, type, text quality, color-by, 2D/3D toggle
- center map: default 2D scatter, optional 3D mode
- right selected-record panel: title, authors, tags, cluster, text quality, nearest neighbors, open-in-viewer action

Map interactions:

- hover point: show title, authors, area/domain tags, cluster label, text quality
- click point: select record
- filter changes update both map and result context
- color-by options: area, domain, cluster, text quality, availability

Record viewer mini map:

- shows selected record plus nearest neighbors
- neighbor list includes similarity score
- clicking a neighbor selects that record
- mini map stays lightweight and does not render the full corpus

Default to 2D. Treat 3D as an optional exploration mode, not the primary experience.

## Failure Handling

Expected failure states:

- abstract unavailable
- embedding unavailable
- low-confidence classification
- cluster label pending
- map metadata missing for a record

These states should be explicit, not silent.

Rules:

- missing abstract is not a failure if fallback text exists
- failed embedding must include a reason
- records with failed map metadata remain available in regular list tabs
- map verifier must fail if a map record references a non-existent browser record

## Verification

Add verification covering:

- every map record id exists in the browser index
- every `nearestNeighbors[].id` resolves to a visible record
- coordinates are finite numbers
- 2D and 3D coordinates are normalized or documented
- all `areaTags` and `domainTags` belong to controlled taxonomies
- every map-unavailable record has a reason
- `embeddingTextQuality` is present for embedded records
- the browser can load `icml2026_index.json` and `icml2026_map.json`
- Map tab renders non-empty data on the deployed GitHub Pages URL
- selecting a map point opens the expected record
- selecting a record shows nearest neighbors in the mini map

## Assumptions

- The initial implementation uses a local scientific embedding model compatible with SPECTER/SPECTER2-style paper embeddings.
- Title-only and title-topic records are acceptable for first-pass map coverage, but must be marked with lower text quality.
- Abstract collection can improve over time without changing the public UI contract.
- Raw embedding vectors are not shipped to GitHub Pages in v1.
- The static site remains deployable from `gh-pages` with no browser-side model inference or API secrets.
