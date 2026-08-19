from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "aso_handoff.py"
SPEC = importlib.util.spec_from_file_location("aso_handoff", SCRIPT)
assert SPEC and SPEC.loader
aso_handoff = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = aso_handoff
SPEC.loader.exec_module(aso_handoff)


class AsoHandoffTests(unittest.TestCase):
    def approved(self) -> dict:
        data = aso_handoff.template("en-US")
        data["sources"] = ["https://apps.apple.com/app/id000000000"]
        values = {
            "description": "Create better iOS apps.",
            "promotional_text": "A focused iOS workflow.",
            "keywords": "ios,swiftui,developer",
            "whats_new": "Improved release reliability.",
        }
        for key, value in values.items():
            data["fields"][key] = {
                "value": value,
                "approval_status": "approved",
            }
        return data

    def test_pending_template_cannot_finalize(self) -> None:
        errors = aso_handoff.validate(aso_handoff.template("en-US"))
        self.assertTrue(errors)
        self.assertTrue(any("approval_status" in error for error in errors))

    def test_all_four_approved_fields_validate(self) -> None:
        self.assertEqual(aso_handoff.validate(self.approved()), [])

    def test_multibyte_keywords_use_100_byte_limit(self) -> None:
        data = self.approved()
        data["fields"]["keywords"]["value"] = "词" * 34
        errors = aso_handoff.validate(data)
        self.assertTrue(any("102 UTF-8 bytes" in error for error in errors))

    def test_keyword_terms_must_be_longer_than_two_characters(self) -> None:
        data = self.approved()
        data["fields"]["keywords"]["value"] = "ai,swiftui,developer"

        errors = aso_handoff.validate(data)

        self.assertIn("each keyword must be at least 3 characters", errors)

    def test_markdown_fence_markup_is_rejected(self) -> None:
        data = self.approved()
        data["fields"]["description"]["value"] = "Before\n ````\nAfter"

        errors = aso_handoff.validate(data)

        self.assertIn("description contains reserved release-form markup", errors)

    def test_locale_marker_markup_is_rejected(self) -> None:
        data = self.approved()
        data["fields"]["description"]["value"] = "Before <!-- locale:ja --> after"

        errors = aso_handoff.validate(data)

        self.assertIn("description contains reserved release-form markup", errors)

    def test_finalize_stamps_aggregate_approval(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "aso-handoff.json"
            path.write_text(
                aso_handoff.json.dumps(self.approved()), encoding="utf-8"
            )
            args = type("Args", (), {"path": str(path)})()

            status = aso_handoff.command_finalize(args)
            finalized = aso_handoff.json.loads(path.read_text(encoding="utf-8"))

            self.assertEqual(status, 0)
            self.assertEqual(finalized["approval_status"], "approved")
            self.assertTrue(finalized["generated_at"].endswith("Z"))


if __name__ == "__main__":
    unittest.main()
