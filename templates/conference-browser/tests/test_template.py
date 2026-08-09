from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml
from cookiecutter.exceptions import FailedHookException
from cookiecutter.main import cookiecutter


TEMPLATE_ROOT = Path(__file__).resolve().parents[1]


def write_archive(root: Path, slug: str, year: int, title_prefix: str, *, include_state: bool = True) -> None:
    queue_path = root / "queues" / slug / f"{year}.jsonl"
    state_path = root / "state" / slug / f"{year}.json"
    queue_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "id": "paper-001",
            "year": year,
            "title": f"{title_prefix} archived paper",
            "authors": ["Ada Example", "Lin Test"],
            "landing_url": "https://example.org/papers/1",
            "pdf_url": "https://example.org/papers/1.pdf",
        },
        {
            "id": "paper-002",
            "year": year,
            "title": f"{title_prefix} unavailable paper",
            "authors": ["Grace Example"],
            "landing_url": "https://example.org/papers/2",
            "pdf_url": "",
            "access_status": "unavailable_public_access",
            "access_reason": "No lawful public PDF was found.",
        },
    ]
    queue_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    if not include_state:
        return
    state = {
        f"{year}:paper-001": {
            **rows[0],
            "status": "uploaded",
            "remote_path": f"/PROJECT_Yeonghyeon/conference-pdf-archive/{slug}/{year}/pdfs/paper-001.pdf",
            "bytes": 12345,
            "sha256": "a" * 64,
            "updated": f"{year}-08-01T00:00:00+00:00",
        }
    }
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class ConferenceBrowserTemplateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.archive_root = self.root / "archive"
        self.output_root = self.root / "output"
        self.output_root.mkdir()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def render(self, name: str, slug: str, year: int, *, include_state: bool = True) -> Path:
        write_archive(self.archive_root, slug, year, name, include_state=include_state)
        project_slug = f"{slug}-{year}-browser"
        rendered = Path(cookiecutter(
            str(TEMPLATE_ROOT),
            no_input=True,
            output_dir=str(self.output_root),
            extra_context={
                "conference_name": name,
                "conference_slug": slug,
                "conference_year": str(year),
                "project_slug": project_slug,
                "archive_root": str(self.archive_root),
            },
        ))
        self.assertEqual(rendered, self.output_root / project_slug)
        return rendered

    def assert_generated_project(
        self,
        project: Path,
        name: str,
        slug: str,
        year: int,
        *,
        expected_archived: int,
        state_present: bool,
    ) -> None:
        subprocess.run([sys.executable, "scripts/build_site.py"], cwd=project, check=True)
        subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=project,
            check=True,
        )
        config = json.loads((project / "conference.json").read_text(encoding="utf-8"))
        artifact = json.loads((project / "docs/data/records.json").read_text(encoding="utf-8"))
        workflow = yaml.safe_load((project / ".github/workflows/pages.yml").read_text(encoding="utf-8"))
        self.assertEqual(config["name"], name)
        self.assertEqual(config["slug"], slug)
        self.assertEqual(config["year"], year)
        self.assertEqual(config["title"], f"{name} {year} Browser")
        self.assertEqual(artifact["conference"]["slug"], slug)
        self.assertEqual(artifact["conference"]["title"], f"{name} {year} Browser")
        self.assertEqual(artifact["summary"]["total"], 2)
        self.assertEqual(artifact["summary"]["archived"], expected_archived)
        self.assertEqual(artifact["summary"]["statePresent"], state_present)
        self.assertIn("jobs", workflow)
        self.assertIn("build", workflow["jobs"])
        self.assertIn("deploy", workflow["jobs"])
        for path in project.rglob("*"):
            if not path.is_file() or path.suffix in {".pyc"}:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            self.assertNotIn("{{", text, path)
            self.assertNotIn("}}", text, path)
        if shutil.which("node"):
            subprocess.run(["node", "--check", "docs/app.js"], cwd=project, check=True)

    def test_two_conference_renders_are_isolated(self) -> None:
        neurips = self.render("NeurIPS", "neurips", 2027)
        miccai = self.render("MICCAI", "miccai", 2028, include_state=False)
        self.assert_generated_project(
            neurips,
            "NeurIPS",
            "neurips",
            2027,
            expected_archived=1,
            state_present=True,
        )
        self.assert_generated_project(
            miccai,
            "MICCAI",
            "miccai",
            2028,
            expected_archived=0,
            state_present=False,
        )
        miccai_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in miccai.rglob("*")
            if path.is_file() and path.suffix in {".json", ".html", ".js", ".md"}
        )
        self.assertNotIn("NeurIPS", miccai_text)
        self.assertNotIn("ICML 2026", miccai_text)

        static_index = (miccai / "docs/index.html").read_text(encoding="utf-8")
        self.assertIn('id="site-title">Conference Browser</h1>', static_index)
        self.assertIn('id="viewer-panel"', static_index)
        self.assertNotIn("MICCAI", static_index)

    def test_invalid_slug_fails_without_project_residue(self) -> None:
        write_archive(self.archive_root, "valid", 2027, "Invalid")
        output = self.output_root / "invalid-project"
        with self.assertRaises(FailedHookException):
            cookiecutter(
                str(TEMPLATE_ROOT),
                no_input=True,
                output_dir=str(self.output_root),
                extra_context={
                    "conference_name": "Invalid",
                    "conference_slug": "../valid",
                    "conference_year": "2027",
                    "project_slug": "invalid-project",
                    "archive_root": str(self.archive_root),
                },
            )
        self.assertFalse(output.exists())

    def test_malformed_state_fails_without_being_treated_as_missing(self) -> None:
        write_archive(self.archive_root, "broken", 2027, "Broken")
        state_path = self.archive_root / "state" / "broken" / "2027.json"
        state_path.write_text("{not-json\n", encoding="utf-8")
        output = self.output_root / "broken-2027-browser"
        with self.assertRaises(FailedHookException):
            cookiecutter(
                str(TEMPLATE_ROOT),
                no_input=True,
                output_dir=str(self.output_root),
                extra_context={
                    "conference_name": "Broken",
                    "conference_slug": "broken",
                    "conference_year": "2027",
                    "project_slug": "broken-2027-browser",
                    "archive_root": str(self.archive_root),
                },
            )
        self.assertFalse(output.exists())

    def test_missing_and_empty_state_have_distinct_provenance(self) -> None:
        project = self.render("MIDL", "midl", 2029, include_state=False)
        artifact_path = project / "docs" / "data" / "records.json"
        missing_state_artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        state_path = self.archive_root / "state" / "midl" / "2029.json"
        state_path.write_text("{}\n", encoding="utf-8")

        subprocess.run(
            [
                sys.executable,
                "scripts/sync_archive.py",
                "--archive-root",
                str(self.archive_root),
            ],
            cwd=project,
            check=True,
        )
        subprocess.run([sys.executable, "scripts/build_site.py"], cwd=project, check=True)
        empty_state_artifact = json.loads(artifact_path.read_text(encoding="utf-8"))

        self.assertFalse(missing_state_artifact["summary"]["statePresent"])
        self.assertTrue(empty_state_artifact["summary"]["statePresent"])
        self.assertNotEqual(
            missing_state_artifact["sourceFingerprint"],
            empty_state_artifact["sourceFingerprint"],
        )

    def test_conference_name_is_runtime_text_not_static_html(self) -> None:
        project = self.render("<script>alert('x')</script> & Test", "safeconf", 2029)
        index_html = (project / "docs" / "index.html").read_text(encoding="utf-8")
        config = json.loads((project / "conference.json").read_text(encoding="utf-8"))
        artifact = json.loads((project / "docs/data/records.json").read_text(encoding="utf-8"))
        self.assertNotIn("<script>alert('x')</script>", index_html)
        self.assertNotIn("&lt;script&gt;", index_html)
        self.assertEqual(config["name"], "<script>alert('x')</script> & Test")
        self.assertEqual(artifact["conference"]["name"], "<script>alert('x')</script> & Test")
        self.assertIn("siteTitle.textContent = data.conference.title", (project / "docs/app.js").read_text(encoding="utf-8"))

    def test_uploaded_state_rejects_nas_path_traversal(self) -> None:
        write_archive(self.archive_root, "unsafe", 2029, "Unsafe")
        state_path = self.archive_root / "state" / "unsafe" / "2029.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["2029:paper-001"]["remote_path"] = (
            "/PROJECT_Yeonghyeon/conference-pdf-archive/unsafe/2029/pdfs/../private.pdf"
        )
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        output = self.output_root / "unsafe-2029-browser"
        with self.assertRaises(FailedHookException):
            cookiecutter(
                str(TEMPLATE_ROOT),
                no_input=True,
                output_dir=str(self.output_root),
                extra_context={
                    "conference_name": "Unsafe",
                    "conference_slug": "unsafe",
                    "conference_year": "2029",
                    "project_slug": "unsafe-2029-browser",
                    "archive_root": str(self.archive_root),
                },
            )
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
