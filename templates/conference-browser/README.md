# Conference Browser Cookiecutter

This template creates one standalone static paper browser for one conference
edition. Its input is the canonical queue and optional archive state maintained
by `conference-pdf-archive`; it never publishes private NAS paths or PDF bytes.
The generated header is populated from the conference data contract, and the
selected-paper pane previews embeddable public PDFs or gives a host-aware open
fallback when cross-origin framing is blocked.

## Generate a site

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/cookiecutter .
```

The generator requires an existing queue at:

```text
<archive_root>/queues/<conference_slug>/<conference_year>.jsonl
```

Generation snapshots the queue and archive state, builds the static site, and
runs its contract tests. A failed hook aborts generation.

## Verify the template

```bash
.venv/bin/python -m unittest discover -s tests -v
```

The template test renders two different conferences from isolated fake
archives, rebuilds them, validates the generated workflow, and checks that no
Cookiecutter tokens or conference-specific values leak across projects.

## Deliberate scope

The generated project includes a searchable/selectable paper list, a two-pane
paper/PDF viewer, explicit public-access and archive states, deterministic
static data, and a GitHub Pages workflow. The viewer uses public HTTP(S) PDF
URLs; it does not copy or proxy archived PDF bytes. Semantic maps, embeddings,
topic/people analysis, references, workshop adapters, and PDF collection remain
out of scope until they have conference-neutral contracts.
