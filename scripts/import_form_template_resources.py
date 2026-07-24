#!/usr/bin/env python3
"""Create form_template resources in the DB service for LMS form-session creation.

A "form template" is a resource (type=form_template) carrying the content-dependent
bits a teacher must NOT type: the Google Sheet URL, the exact sheet/tab name, the
single-page header, and the canonical form flags. The LMS Forms picker lists these;
selecting one + a batch + a window creates a form session, which the sessionCreator
Lambda turns into a questionnaire quiz by reading the named sheet tab.

Canonical form values (from quiz-creator Options.ts / form flow):
  test_type=form, test_format=questionnaire, gurukul_format_type=qa,
  marking_scheme="1, 0", optional_limits=N/A, stream=Others,
  show_answers=false, show_scores=false, shuffle=false, is_advanced_format=false.

sessionCreator reads cms_test_id as the full Sheets URL (it takes URL segment 5 as
the spreadsheet ID; the #gid is ignored) and opens the tab by sheet_name (exact tab
title). So cms_test_id MUST be the canonical /spreadsheets/d/<ID>/edit form and
sheet_name MUST match the tab's display name byte-for-byte.

Dry-run by default. Re-run with --upload to POST new resources. Dedup by code.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


RESOURCE_TYPE = "form_template"
SOURCE = "lms"

# The workbook holding all three form sheets. Canonical /spreadsheets/d/<ID>/edit
# shape so sessionCreator's split("/")[5] extracts the ID correctly.
SPREADSHEET_ID = "1F_W58M6Uw2U-XsGgK3ocAfnH2ifPcZRCfaNCt9i_c1E"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"

# Values common to every form template. grade is intentionally omitted for the
# grade-agnostic Student Profile form (grade comes from the batch at creation);
# grade-specific baseline forms set it explicitly below.
COMMON = {
    "test_type": "form",
    "test_format": "questionnaire",
    "gurukul_format_type": "qa",
    "marking_scheme": "1, 0",
    "optional_limits": "N/A",
    "stream": "Others",
    "course": "Photon",
    "test_purpose": "baseline",
    "show_answers": False,
    "show_scores": False,
    "shuffle": False,
    "require_all_questions": False,
    "is_advanced_format": False,
    "is_active": True,
    "cms_link": SHEET_URL,
    "cms_test_id": SHEET_URL,
}

# One entry per template. `sheet_name` MUST match the tab title in the workbook.
# `single_page_header_text` is the form's header; for the grade-agnostic Student
# Profile it is a base string the create route appends the grade to at session time.
TEMPLATES = [
    {
        "code": "FORM-STUDENT-PROFILE",
        "name": "Student Profile Questions",
        "type_params": {
            **COMMON,
            "sheet_name": "Student Profile Questions",
            "single_page_header_text": "Student Profile Form",
            # grade-agnostic: no `grade` key — sourced from the batch at creation.
        },
    },
    {
        "code": "FORM-BASELINE-G11",
        "name": "Baseline Questions G11",
        "type_params": {
            **COMMON,
            "grade": 11,
            "sheet_name": "Baseline Questions G11",
            "single_page_header_text": "Student Mentoring Baseline G11",
        },
    },
    {
        "code": "FORM-BASELINE-G12",
        "name": "Baseline Questions G12",
        "type_params": {
            **COMMON,
            "grade": 12,
            "sheet_name": "Baseline Questions G12",
            "single_page_header_text": "Student Mentoring Baseline G12",
        },
    },
]


def resource_payload(template: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": RESOURCE_TYPE,
        "subtype": "form",
        "source": SOURCE,
        "code": template["code"],
        "name": [{"resource": template["name"], "lang_code": "en"}],
        "type_params": template["type_params"],
    }


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def request_json(method: str, url: str, token: str, body: dict[str, Any] | None = None) -> Any:
    data = None
    headers = {"Authorization": f"Bearer {token}", "accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {exc.code}: {detail}") from exc


def existing_codes(base_url: str, token: str) -> set[str]:
    query = urllib.parse.urlencode(
        {"type": RESOURCE_TYPE, "limit": "500", "sort_by": "code", "sort_order": "asc"}
    )
    resources = request_json("GET", f"{base_url.rstrip('/')}/resource?{query}", token)
    if not isinstance(resources, list):
        raise RuntimeError("Expected DB service /resource to return a list")
    return {str(item.get("code")).strip() for item in resources if isinstance(item, dict) and item.get("code")}


def upload(payloads: list[dict[str, Any]], base_url: str, token: str) -> None:
    have = existing_codes(base_url, token)
    created = skipped = 0
    for payload in payloads:
        code = payload["code"]
        if code in have:
            print(f"skip existing {code}")
            skipped += 1
            continue
        result = request_json("POST", f"{base_url.rstrip('/')}/resource", token, payload)
        rid = result.get("id") if isinstance(result, dict) else ""
        print(f"created {code}: id={rid}")
        created += 1
    print(f"\nUpload complete: {created} created, {skipped} skipped.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--db-url", default=None, help="DB service base URL (default: DB_SERVICE_URL)")
    parser.add_argument("--db-token", default=None, help="DB service token (default: DB_SERVICE_TOKEN)")
    parser.add_argument("--jsonl-out", type=Path, default=Path("tmp/form-template-resources.jsonl"))
    parser.add_argument("--upload", action="store_true", help="POST new resources (default: dry run)")
    args = parser.parse_args()

    load_env_file(args.env_file)
    db_url = args.db_url or os.environ.get("DB_SERVICE_URL")
    db_token = args.db_token or os.environ.get("DB_SERVICE_TOKEN")

    payloads = [resource_payload(t) for t in TEMPLATES]

    args.jsonl_out.parent.mkdir(parents=True, exist_ok=True)
    with args.jsonl_out.open("w", encoding="utf-8") as f:
        for payload in payloads:
            f.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Prepared {len(payloads)} form templates:")
    for payload in payloads:
        tp = payload["type_params"]
        print(
            f"  {payload['code']:22} sheet_name={tp['sheet_name']!r} "
            f"grade={tp.get('grade', '(from batch)')} header={tp['single_page_header_text']!r}"
        )
    print(f"\nWrote payloads: {args.jsonl_out}")
    print(f"Target DB: {db_url or '(unset)'}")

    if args.upload:
        if not db_url or not db_token:
            raise RuntimeError("Set DB_SERVICE_URL and DB_SERVICE_TOKEN, or pass --db-url/--db-token")
        upload(payloads, db_url, db_token)
    else:
        print("\nDry run only. Re-run with --upload to POST new resources.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
