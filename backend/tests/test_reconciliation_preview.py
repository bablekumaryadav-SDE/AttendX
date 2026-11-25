"""Synthetic-only unit tests for the database-free reconciliation preview."""

import unittest
import json
import sys
import tempfile
import uuid
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts.reconciliation_preview import PreviewInputError, build_preview, main, render_csv


class IsolatedTempFiles:
    """Create flat fixtures because this Windows runner denies new temp dirs."""

    def __init__(self, output_suffix):
        self.root = Path(__file__).resolve().parents[2]
        handle = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix="attendx-reconciliation-input-",
            suffix=".json",
            dir=self.root,
            delete=False,
        )
        self.input = Path(handle.name)
        handle.close()
        self.output = self.root / f"attendx-reconciliation-output-{uuid.uuid4().hex}{output_suffix}"
        if self.output.exists():
            self.input.unlink(missing_ok=True)
            raise FileExistsError("Refusing to reuse a temporary reconciliation output path.")

    def __enter__(self):
        return self.input, self.output

    def __exit__(self, exc_type, exc, traceback):
        self.input.unlink(missing_ok=True)
        self.output.unlink(missing_ok=True)
        return False


class ReconciliationPreviewTests(unittest.TestCase):
    def test_proposals_are_never_approved_or_applied(self):
        report = build_preview({
            "records": [{"entity": "students", "source_id": 11}],
            "proposals": [{
                "entity": "students",
                "source_id": 11,
                "institution_ref": "INST-REF-1",
                "evidence_ref": "EVID-REF-1",
                "confidence": "HIGH",
            }],
        })
        self.assertFalse(report["ownership_assignments_applied"])
        self.assertEqual(report["review_status"], "REVIEW_REQUIRED")
        self.assertEqual(report["proposals"][0]["status"], "UNAPPROVED")

    def test_duplicate_source_primary_keys_are_reported(self):
        report = build_preview({
            "records": [
                {"entity": "students", "source_id": 11},
                {"entity": "students", "source_id": 11},
            ],
            "proposals": [],
        })
        self.assertIn("DUPLICATE_SOURCE_ID", {item["code"] for item in report["findings"]})

    def test_missing_required_parent_reference_is_reported(self):
        report = build_preview({
            "records": [{"entity": "teacher_assignments", "source_id": 31}],
            "proposals": [],
        })
        missing = [item for item in report["findings"] if item["code"] == "MISSING_PARENT_REFERENCE"]
        self.assertEqual({item["related_entity"] for item in missing}, {"teachers", "subjects", "classes"})

    def test_missing_parent_record_is_reported(self):
        report = build_preview({
            "records": [{
                "entity": "face_embeddings",
                "source_id": 41,
                "parents": [{"entity": "students", "source_id": 12}],
            }],
            "proposals": [],
        })
        self.assertIn("MISSING_PARENT_RECORD", {item["code"] for item in report["findings"]})

    def test_conflicting_institution_proposals_are_reported_and_unapproved(self):
        report = build_preview({
            "records": [{"entity": "classes", "source_id": 8}],
            "proposals": [
                {"entity": "classes", "source_id": 8, "institution_ref": "INST-A", "evidence_ref": "EVID-1"},
                {"entity": "classes", "source_id": 8, "institution_ref": "INST-B", "evidence_ref": "EVID-2"},
            ],
        })
        self.assertIn("CONFLICTING_INSTITUTION_PROPOSALS", {item["code"] for item in report["findings"]})
        self.assertEqual({item["status"] for item in report["proposals"]}, {"CONFLICT"})
        self.assertFalse(report["ownership_assignments_applied"])

    def test_proposal_for_missing_source_record_is_reported(self):
        report = build_preview({
            "records": [],
            "proposals": [{
                "entity": "classes", "source_id": 8,
                "institution_ref": "INST-A", "evidence_ref": "EVID-1",
            }],
        })
        self.assertIn("PROPOSAL_SOURCE_MISSING", {item["code"] for item in report["findings"]})

    def test_unmapped_record_is_reported_without_an_assignment(self):
        report = build_preview({
            "records": [{"entity": "classes", "source_id": 8}],
            "proposals": [],
        })
        self.assertIn("NO_OWNERSHIP_PROPOSAL", {item["code"] for item in report["findings"]})
        self.assertEqual(report["summary"]["unmapped_records"], 1)

    def test_parent_and_child_proposals_to_different_institutions_conflict(self):
        report = build_preview({
            "records": [
                {"entity": "students", "source_id": 11},
                {"entity": "classes", "source_id": 8},
                {"entity": "student_class_assignments", "source_id": 21, "parents": [
                    {"entity": "students", "source_id": 11},
                    {"entity": "classes", "source_id": 8},
                ]},
            ],
            "proposals": [
                {"entity": "students", "source_id": 11, "institution_ref": "INST-A", "evidence_ref": "EVID-1"},
                {"entity": "classes", "source_id": 8, "institution_ref": "INST-A", "evidence_ref": "EVID-2"},
                {"entity": "student_class_assignments", "source_id": 21, "institution_ref": "INST-B", "evidence_ref": "EVID-3"},
            ],
        })
        self.assertIn(
            "CROSS_PARENT_INSTITUTION_PROPOSAL_CONFLICT",
            {item["code"] for item in report["findings"]},
        )

    def test_unknown_sensitive_fields_are_rejected_without_echoing_values(self):
        with self.assertRaises(PreviewInputError) as raised:
            build_preview({
                "records": [{"entity": "users", "source_id": 7, "password": "synthetic-secret"}],
                "proposals": [],
            })
        self.assertNotIn("synthetic-secret", str(raised.exception))

    def test_personal_identifiers_are_not_accepted_as_primary_keys(self):
        for source_id in ("person@example.org", "auth-token", True, 0, -4):
            with self.subTest(source_id_type=type(source_id).__name__):
                with self.assertRaises(PreviewInputError):
                    build_preview({
                        "records": [{"entity": "users", "source_id": source_id}],
                        "proposals": [],
                    })

    def test_csv_contains_only_allowlisted_preview_fields(self):
        report = build_preview({
            "records": [{"entity": "students", "source_id": 11}],
            "proposals": [{
                "entity": "students", "source_id": 11,
                "institution_ref": "INST-A", "evidence_ref": "EVID-1",
            }],
        })
        output = render_csv(report)
        self.assertIn("UNAPPROVED", output)
        self.assertIn("INST-A", output)
        self.assertNotIn("password", output.lower())
        self.assertNotIn("email", output.lower())

    def test_cli_writes_unapproved_json_and_refuses_to_overwrite(self):
        with IsolatedTempFiles(".json") as (input_path, output_path):
            input_path.write_text(json.dumps({
                "records": [{"entity": "classes", "source_id": 8}],
                "proposals": [{
                    "entity": "classes", "source_id": 8,
                    "institution_ref": "INST-A", "evidence_ref": "EVID-1",
                }],
            }), encoding="utf-8")
            args = ["reconciliation_preview.py", "--input", str(input_path), "--output", str(output_path)]
            with patch.object(sys, "argv", args):
                self.assertEqual(main(), 0)
            first = output_path.read_text(encoding="utf-8")
            parsed = json.loads(first)
            self.assertFalse(parsed["ownership_assignments_applied"])
            self.assertEqual(parsed["proposals"][0]["status"], "UNAPPROVED")

            with patch.object(sys, "argv", args), redirect_stderr(StringIO()):
                self.assertEqual(main(), 2)
            self.assertEqual(output_path.read_text(encoding="utf-8"), first)

    def test_cli_can_write_reviewable_csv(self):
        with IsolatedTempFiles(".csv") as (input_path, output_path):
            input_path.write_text(json.dumps({
                "records": [{"entity": "students", "source_id": 11}],
                "proposals": [{
                    "entity": "students", "source_id": 11,
                    "institution_ref": "INST-A", "evidence_ref": "EVID-1",
                }],
            }), encoding="utf-8")
            args = ["reconciliation_preview.py", "--input", str(input_path), "--output", str(output_path), "--format", "csv"]
            with patch.object(sys, "argv", args):
                self.assertEqual(main(), 0)
            output = output_path.read_text(encoding="utf-8")
            self.assertIn("UNAPPROVED", output)
            self.assertIn("INST-A", output)


if __name__ == "__main__":
    unittest.main()
