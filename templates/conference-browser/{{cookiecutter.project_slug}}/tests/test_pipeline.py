from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contracts import (  # noqa: E402
    PUBLIC_RECORD_KEYS,
    assert_public_safe,
    public_url,
    sha256_bytes,
)


class GeneratedProjectContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run([sys.executable, "scripts/build_site.py"], cwd=ROOT, check=True)
        cls.artifact_path = ROOT / "docs" / "data" / "records.json"
        cls.manifest_path = ROOT / "docs" / "data" / "manifest.json"
        cls.artifact_bytes = cls.artifact_path.read_bytes()
        cls.artifact = json.loads(cls.artifact_bytes)
        cls.manifest = json.loads(cls.manifest_path.read_text(encoding="utf-8"))

    def test_output_contract_and_allowlist(self) -> None:
        self.assertEqual(self.artifact["schemaVersion"], "conference-browser-records/v1")
        self.assertEqual(self.artifact["summary"]["total"], len(self.artifact["records"]))
        ids = [record["id"] for record in self.artifact["records"]]
        self.assertEqual(len(ids), len(set(ids)))
        for record in self.artifact["records"]:
            self.assertEqual(set(record), PUBLIC_RECORD_KEYS)

    def test_private_archive_paths_are_not_public(self) -> None:
        text = self.artifact_bytes.decode("utf-8")
        for forbidden in (
            "/PROJECT_Yeonghyeon/",
            "/Users/",
            "/private/var/",
            "/tmp/",
            "C:\\Users\\",
            "remote_path",
            "local_path",
            "sftp:",
        ):
            self.assertNotIn(forbidden, text)
        public_files = [path for path in (ROOT / "docs").rglob("*") if path.is_file()]
        for path in public_files:
            try:
                public_text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for forbidden in ("/PROJECT_Yeonghyeon/", "/Users/", "C:\\Users\\", "file://", "sftp://"):
                self.assertNotIn(forbidden, public_text, path)

    def test_public_safety_rejects_local_paths_and_unsafe_urls(self) -> None:
        for private_value in ("/tmp/private.pdf", "/PRIVATE/VAR/data", r"C:\Users\name\file.pdf"):
            with self.assertRaises(ValueError):
                assert_public_safe({"value": private_value})
        for unsafe_url in (
            "file:///tmp/private.pdf",
            "sftp://example.org/paper.pdf",
            "https://user:secret@example.org/paper.pdf",
            "https://example.org/paper name.pdf",
            "https://example.org/paper.pdf?token=secret",
        ):
            with self.assertRaises(ValueError):
                public_url(unsafe_url, "test.url", required=True)

    def test_manifest_pins_exact_artifact(self) -> None:
        self.assertEqual(
            self.manifest["artifactSha256"],
            f"sha256:{sha256_bytes(self.artifact_bytes)}",
        )
        self.assertEqual(self.manifest["recordCount"], len(self.artifact["records"]))
        self.assertEqual(self.manifest["sourceFingerprint"], self.artifact["sourceFingerprint"])

    def test_static_shell_is_conference_neutral_and_has_pdf_viewer(self) -> None:
        index_html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        app_js = (ROOT / "docs" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="site-title">Conference Browser</h1>', index_html)
        self.assertIn('id="viewer-panel"', index_html)
        self.assertIn("siteTitle.textContent = data.conference.title", app_js)
        self.assertIn("renderPdfPreview(record)", app_js)

    def test_rebuild_is_byte_deterministic(self) -> None:
        before_records = self.artifact_path.read_bytes()
        before_manifest = self.manifest_path.read_bytes()
        subprocess.run([sys.executable, "scripts/build_site.py"], cwd=ROOT, check=True)
        self.assertEqual(before_records, self.artifact_path.read_bytes())
        self.assertEqual(before_manifest, self.manifest_path.read_bytes())


if __name__ == "__main__":
    unittest.main()
