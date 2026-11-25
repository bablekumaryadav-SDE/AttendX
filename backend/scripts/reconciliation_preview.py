"""Read-only, database-free ownership reconciliation preview.

Input is an explicitly supplied JSON inventory containing integer primary keys
and opaque evidence/institution references. Proposed mappings are always
UNAPPROVED. This module deliberately has no application/database imports.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


MAX_INPUT_BYTES = 5 * 1024 * 1024
MAX_RECORDS = 50_000
MAX_PROPOSALS = 100_000
OPAQUE_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")

ENTITIES = {
    "users",
    "students",
    "teachers",
    "student_id_counters",
    "classes",
    "subjects",
    "teacher_assignments",
    "student_class_assignments",
    "attendance",
    "attendance_records",
    "attendance_sessions",
    "attendance_events",
    "face_embeddings",
    "student_guardians",
    "notification_events",
    "attendance_audit_logs",
}

REQUIRED_PARENTS = {
    "teacher_assignments": {"teachers", "subjects", "classes"},
    "student_class_assignments": {"students", "classes"},
    "attendance": {"students", "teachers"},
    "attendance_records": {"students", "teachers", "subjects", "classes"},
    "attendance_sessions": {"teachers", "subjects", "classes"},
    "attendance_events": {"attendance_sessions", "students"},
    "face_embeddings": {"students"},
    "student_guardians": {"students"},
}

REQUIRED_PARENT_GROUPS = {
    # Current notification rows may reference either an account or student.
    "notification_events": ({"users", "students"},),
}


class PreviewInputError(ValueError):
    """A sanitized input validation error; never includes user-provided values."""


def _check_keys(value: Any, allowed: set[str], required: set[str]) -> None:
    if not isinstance(value, dict) or not required.issubset(value) or not set(value).issubset(allowed):
        raise PreviewInputError("Input object does not match the allowed preview schema.")


def _entity(value: Any) -> str:
    if not isinstance(value, str) or value not in ENTITIES:
        raise PreviewInputError("Input contains an unsupported record type.")
    return value


def _source_id(value: Any) -> int:
    # Source PKs in the inspected AttendX schema are integers. Reject booleans,
    # strings, emails and other identifiers to keep preview output minimal.
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PreviewInputError("Source IDs must be positive integer primary keys.")
    return value


def _opaque_ref(value: Any) -> str:
    if not isinstance(value, str) or not OPAQUE_REF_RE.fullmatch(value):
        raise PreviewInputError("Evidence and institution references must be opaque reference tokens.")
    return value


def _parse_records(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list) or len(items) > MAX_RECORDS:
        raise PreviewInputError("Records must be a bounded JSON array.")

    records = []
    for item in items:
        _check_keys(item, {"entity", "source_id", "parents"}, {"entity", "source_id"})
        entity = _entity(item["entity"])
        source_id = _source_id(item["source_id"])
        parents_value = item.get("parents", [])
        if not isinstance(parents_value, list) or len(parents_value) > 20:
            raise PreviewInputError("Parent references must be a bounded JSON array.")

        parents = []
        seen_parent_entities = set()
        for parent in parents_value:
            _check_keys(parent, {"entity", "source_id"}, {"entity", "source_id"})
            parent_entity = _entity(parent["entity"])
            parent_id = _source_id(parent["source_id"])
            if parent_entity in seen_parent_entities:
                raise PreviewInputError("A record has repeated parent types.")
            seen_parent_entities.add(parent_entity)
            parents.append({"entity": parent_entity, "source_id": parent_id})

        records.append({"entity": entity, "source_id": source_id, "parents": parents})
    return records


def _parse_proposals(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list) or len(items) > MAX_PROPOSALS:
        raise PreviewInputError("Proposals must be a bounded JSON array.")

    proposals = []
    for item in items:
        _check_keys(
            item,
            {"entity", "source_id", "institution_ref", "evidence_ref", "confidence"},
            {"entity", "source_id", "institution_ref", "evidence_ref"},
        )
        confidence = item.get("confidence", "UNKNOWN")
        if not isinstance(confidence, str) or confidence not in {"HIGH", "MEDIUM", "LOW", "UNKNOWN"}:
            raise PreviewInputError("Proposal confidence is not an allowed value.")
        proposals.append({
            "entity": _entity(item["entity"]),
            "source_id": _source_id(item["source_id"]),
            "institution_ref": _opaque_ref(item["institution_ref"]),
            "evidence_ref": _opaque_ref(item["evidence_ref"]),
            "confidence": confidence,
        })
    return proposals


def build_preview(payload: Any) -> dict[str, Any]:
    """Analyze only the supplied inventory; never persists or applies mappings."""
    _check_keys(payload, {"records", "proposals"}, {"records", "proposals"})
    records = _parse_records(payload["records"])
    proposals = _parse_proposals(payload["proposals"])

    record_counts = Counter((record["entity"], record["source_id"]) for record in records)
    record_keys = set(record_counts)
    findings: list[dict[str, Any]] = []

    for (entity, source_id), count in sorted(record_counts.items()):
        if count > 1:
            findings.append({
                "code": "DUPLICATE_SOURCE_ID",
                "entity": entity,
                "source_id": source_id,
                "related_entity": None,
                "related_source_id": None,
            })

    for record in records:
        key = (record["entity"], record["source_id"])
        parent_types = {parent["entity"] for parent in record["parents"]}
        for required in sorted(REQUIRED_PARENTS.get(record["entity"], set())):
            if required not in parent_types:
                findings.append({
                    "code": "MISSING_PARENT_REFERENCE",
                    "entity": record["entity"],
                    "source_id": record["source_id"],
                    "related_entity": required,
                    "related_source_id": None,
                })
        for group in REQUIRED_PARENT_GROUPS.get(record["entity"], ()):
            if not parent_types.intersection(group):
                findings.append({
                    "code": "MISSING_PARENT_REFERENCE",
                    "entity": record["entity"],
                    "source_id": record["source_id"],
                    "related_entity": "|".join(sorted(group)),
                    "related_source_id": None,
                })
        for parent in record["parents"]:
            parent_key = (parent["entity"], parent["source_id"])
            parent_count = record_counts.get(parent_key, 0)
            if parent_count == 0:
                code = "MISSING_PARENT_RECORD"
            elif parent_count > 1:
                code = "AMBIGUOUS_PARENT_ID"
            else:
                continue
            findings.append({
                "code": code,
                "entity": key[0],
                "source_id": key[1],
                "related_entity": parent["entity"],
                "related_source_id": parent["source_id"],
            })

    proposals_by_key: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for proposal in proposals:
        key = (proposal["entity"], proposal["source_id"])
        proposals_by_key[key].append(proposal)
        if key not in record_keys:
            findings.append({
                "code": "PROPOSAL_SOURCE_MISSING",
                "entity": key[0],
                "source_id": key[1],
                "related_entity": None,
                "related_source_id": None,
            })

    for record in records:
        key = (record["entity"], record["source_id"])
        if key not in proposals_by_key:
            findings.append({
                "code": "NO_OWNERSHIP_PROPOSAL",
                "entity": key[0],
                "source_id": key[1],
                "related_entity": None,
                "related_source_id": None,
            })
            continue
        child_refs = {item["institution_ref"] for item in proposals_by_key[key]}
        for parent in record["parents"]:
            parent_key = (parent["entity"], parent["source_id"])
            parent_proposals = proposals_by_key.get(parent_key, [])
            parent_refs = {item["institution_ref"] for item in parent_proposals}
            if parent_refs and child_refs != parent_refs:
                findings.append({
                    "code": "CROSS_PARENT_INSTITUTION_PROPOSAL_CONFLICT",
                    "entity": key[0],
                    "source_id": key[1],
                    "related_entity": parent["entity"],
                    "related_source_id": parent["source_id"],
                })

    rendered_proposals = []
    for key, group in sorted(proposals_by_key.items()):
        institution_refs = {item["institution_ref"] for item in group}
        conflict = len(institution_refs) > 1
        if conflict:
            findings.append({
                "code": "CONFLICTING_INSTITUTION_PROPOSALS",
                "entity": key[0],
                "source_id": key[1],
                "related_entity": None,
                "related_source_id": None,
            })
        proposal_counts = Counter(
            (item["institution_ref"], item["evidence_ref"], item["confidence"])
            for item in group
        )
        for item in group:
            rendered_proposals.append({
                **item,
                "status": "CONFLICT" if conflict else "UNAPPROVED",
                "duplicate_proposal": proposal_counts[(
                    item["institution_ref"], item["evidence_ref"], item["confidence"]
                )] > 1,
            })

    findings.sort(key=lambda item: (
        item["entity"], item["source_id"], item["code"],
        item["related_entity"] or "", item["related_source_id"] or 0,
    ))
    rendered_proposals.sort(key=lambda item: (
        item["entity"], item["source_id"], item["institution_ref"], item["evidence_ref"]
    ))
    return {
        "report_type": "attendx_legacy_ownership_preview",
        "review_status": "REVIEW_REQUIRED",
        "ownership_assignments_applied": False,
        "summary": {
            "record_count": len(records),
            "proposal_count": len(proposals),
            "finding_count": len(findings),
            "duplicate_source_ids": sum(item["code"] == "DUPLICATE_SOURCE_ID" for item in findings),
            "missing_parent_findings": sum(item["code"].startswith("MISSING_PARENT") for item in findings),
            "conflicting_mapping_groups": sum(item["code"] == "CONFLICTING_INSTITUTION_PROPOSALS" for item in findings),
            "cross_parent_mapping_conflicts": sum(item["code"] == "CROSS_PARENT_INSTITUTION_PROPOSAL_CONFLICT" for item in findings),
            "unmapped_records": sum(item["code"] == "NO_OWNERSHIP_PROPOSAL" for item in findings),
            "unapproved_proposals": sum(item["status"] == "UNAPPROVED" for item in rendered_proposals),
        },
        "proposals": rendered_proposals,
        "findings": findings,
    }


CSV_FIELDS = (
    "row_type", "entity", "source_id", "related_entity", "related_source_id",
    "code", "institution_ref", "evidence_ref", "confidence", "status",
)


def render_csv(report: dict[str, Any]) -> str:
    """Render only allowlisted IDs/references/findings; no source payload is copied."""
    from io import StringIO

    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for proposal in report["proposals"]:
        writer.writerow({"row_type": "PROPOSAL", **proposal})
    for finding in report["findings"]:
        writer.writerow({"row_type": "FINDING", **finding})
    return output.getvalue()


def _load_input(path: Path) -> Any:
    try:
        raw_bytes = path.read_bytes()
    except PreviewInputError:
        raise
    except OSError as exc:
        raise PreviewInputError("Input file could not be read.") from exc
    if len(raw_bytes) > MAX_INPUT_BYTES:
        raise PreviewInputError("Input exceeds the preview size limit.")
    try:
        return json.loads(raw_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise PreviewInputError("Input file is not valid UTF-8 JSON.") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Explicit isolated JSON inventory path")
    parser.add_argument("--output", required=True, help="New output path; existing files are never overwritten")
    parser.add_argument("--format", choices=("json", "csv"), default="json")
    args = parser.parse_args(argv)

    source = Path(args.input)
    destination = Path(args.output)
    try:
        if source.resolve() == destination.resolve():
            raise PreviewInputError("Input and output paths must be different.")
        report = build_preview(_load_input(source))
        content = (
            json.dumps(report, indent=2, sort_keys=True) + "\n"
            if args.format == "json"
            else render_csv(report)
        )
        # Exclusive create preserves all existing user artifacts/backups.
        with destination.open("x", encoding="utf-8", newline="") as output:
            output.write(content)
    except FileExistsError:
        print("Preview output already exists; choose a new path.", file=sys.stderr)
        return 2
    except (PreviewInputError, OSError) as exc:
        # Never echo input values, credentials, or filesystem paths.
        message = str(exc) if isinstance(exc, PreviewInputError) else "Preview could not be read or written."
        print(f"Reconciliation preview refused: {message}", file=sys.stderr)
        return 2

    summary = report["summary"]
    print(
        "Unapproved preview created: "
        f"records={summary['record_count']} proposals={summary['proposal_count']} findings={summary['finding_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
