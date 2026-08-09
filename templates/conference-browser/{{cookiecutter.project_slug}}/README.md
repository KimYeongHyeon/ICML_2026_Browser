# {{ cookiecutter.conference_name }} {{ cookiecutter.conference_year }} Browser

Static paper browser generated from the canonical conference PDF archive.

## Data contract

- Queue source: `queues/{{ cookiecutter.conference_slug }}/{{ cookiecutter.conference_year }}.jsonl`
- Archive state: `state/{{ cookiecutter.conference_slug }}/{{ cookiecutter.conference_year }}.json`
- Committed snapshot: `data/source/`
- Static artifact: `docs/data/records.json`

Private NAS and local filesystem paths are provenance only. They are validated
during synchronization and never emitted into `docs/`; only public HTTP(S)
source and PDF URLs are browser links. Selecting a paper fills the right-hand
viewer. Embeddable hosts render inline; known framing-blocked hosts get a clear
open-in-new-tab fallback rather than a blank pane.

## Refresh from the archive

```bash
python3 scripts/sync_archive.py --archive-root /path/to/conference-pdf-archive
python3 scripts/build_site.py
python3 -m unittest discover -s tests -v
```

`sync_archive.py` uses the archive's queue/state advisory locks and writes a
hash commit manifest last. A partial or inconsistent snapshot therefore fails
the build instead of being published.

## Preview

```bash
python3 -m http.server 8787 --directory docs
```

Open <http://localhost:8787/>.

## Deploy

Commit the generated project, including `data/source/` and `docs/data/`, then
enable GitHub Pages with GitHub Actions as the source. The included workflow
rebuilds and byte-checks the committed artifact before deployment.
