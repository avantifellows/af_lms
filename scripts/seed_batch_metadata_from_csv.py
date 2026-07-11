#!/usr/bin/env python3
"""Backfill descriptive attributes into batch.metadata from the DCF CSV.

Merges grade / region / state / district / stream / program_type into each
batch's existing jsonb `metadata`, preserving keys already present (e.g.
`is_parent_batch`). Matches CSV rows to batches by `Batch ID` -> batch.batch_id.

The batch <-> centre LINK is intentionally NOT written here; that lives in the
`centre_batch` join table (see seed_centre_batch_from_csv.py). This script only
writes attributes that describe the batch itself.

Dry-run by default. Re-run with --execute to write.
"""
import argparse
import csv
import json
import os
from pathlib import Path

import psycopg2


DEFAULT_CSV_PATH = "tmp/DCF - 2026-2027 (JNV & EMRS) - batch_list.csv"

# CSV column -> metadata key. Values are stored as strings except `grade`,
# which is coerced to int below.
ATTRIBUTE_COLUMNS = {
    "Region": "region",
    "State": "state",
    "District": "district",
    "Stream": "stream",
    "Program Type": "program_type",
}


def load_env(path=".env.local"):
    env_path = Path(path)
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_conn():
    sslmode = "disable" if os.environ.get("DATABASE_SSL") == "false" else "require"
    return psycopg2.connect(
        host=os.environ["DATABASE_HOST"],
        port=int(os.environ.get("DATABASE_PORT", "5432")),
        user=os.environ["DATABASE_USER"],
        password=os.environ["DATABASE_PASSWORD"],
        dbname=os.environ["DATABASE_NAME"],
        sslmode=sslmode,
    )


def build_attributes(row):
    """Return the attribute dict for a CSV row, omitting blank values."""
    attrs = {}
    for column, key in ATTRIBUTE_COLUMNS.items():
        value = (row.get(column) or "").strip()
        if value:
            attrs[key] = value

    grade_raw = (row.get("Grade") or "").strip()
    if grade_raw:
        try:
            attrs["grade"] = int(grade_raw)
        except ValueError:
            raise RuntimeError(f"Non-integer Grade value: {grade_raw!r}")

    return attrs


def read_rows(csv_path):
    rows = []
    seen = set()
    duplicates = []

    with Path(csv_path).open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        required_columns = {"Batch ID", "Grade"}
        missing_columns = required_columns - set(reader.fieldnames or [])
        if missing_columns:
            raise RuntimeError(f"Missing required CSV columns: {sorted(missing_columns)}")

        for line_number, row in enumerate(reader, start=2):
            batch_external_id = (row.get("Batch ID") or "").strip()
            if not batch_external_id:
                raise RuntimeError(f"Missing Batch ID on CSV line {line_number}")

            if batch_external_id in seen:
                duplicates.append((line_number, batch_external_id))
                continue
            seen.add(batch_external_id)

            rows.append(
                {
                    "line_number": line_number,
                    "batch_external_id": batch_external_id,
                    "attributes": build_attributes(row),
                }
            )

    return rows, duplicates


def fetch_one(cur, query, params):
    cur.execute(query, params)
    return cur.fetchone()


def preflight(cur, rows):
    to_update = []
    missing_batches = []
    no_attributes = []

    for row in rows:
        batch = fetch_one(
            cur,
            "SELECT id, batch_id, metadata FROM batch WHERE batch_id = %s",
            (row["batch_external_id"],),
        )
        if not batch:
            missing_batches.append(row)
            continue

        if not row["attributes"]:
            no_attributes.append(row)
            continue

        to_update.append(
            {
                **row,
                "batch_pk": batch[0],
                "existing_metadata": batch[2] or {},
            }
        )

    return to_update, missing_batches, no_attributes


def apply_updates(cur, to_update):
    """Merge attributes into each batch's jsonb metadata, preserving existing keys."""
    updated = 0
    for row in to_update:
        cur.execute(
            "UPDATE batch SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb, "
            "updated_at = now() WHERE id = %s",
            (json.dumps(row["attributes"]), row["batch_pk"]),
        )
        updated += cur.rowcount
    return updated


def print_sample(title, items, formatter, limit=15):
    print(f"\n{title}: {len(items)}")
    for item in items[:limit]:
        print(f"  {formatter(item)}")
    if len(items) > limit:
        print(f"  ... and {len(items) - limit} more")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=DEFAULT_CSV_PATH, help="Path to DCF batch_list CSV")
    parser.add_argument("--execute", action="store_true", help="Apply updates (default: dry run)")
    parser.add_argument(
        "--skip-missing",
        action="store_true",
        help="Tolerate CSV batches absent from the DB (skip them) instead of aborting. "
        "Use on staging, which lags prod's batch table; keep OFF on prod so an "
        "unexpectedly missing batch fails loud.",
    )
    args = parser.parse_args()

    load_env()

    rows, duplicates = read_rows(args.csv)

    with get_conn() as conn:
        with conn.cursor() as cur:
            to_update, missing_batches, no_attributes = preflight(cur, rows)

            print(f"csv rows read: {len(rows)}")
            print_sample(
                "duplicate CSV batch ids skipped",
                duplicates,
                lambda row: f"line {row[0]} | {row[1]}",
            )
            print_sample(
                "rows with no usable attributes (skipped)",
                no_attributes,
                lambda row: f"line {row['line_number']} | {row['batch_external_id']}",
            )
            print_sample(
                "ready to update",
                to_update,
                lambda row: (
                    f"line {row['line_number']} | {row['batch_external_id']} "
                    f"+= {json.dumps(row['attributes'])} "
                    f"(existing: {json.dumps(row['existing_metadata'])})"
                ),
            )
            print_sample(
                "missing batches (not in DB)",
                missing_batches,
                lambda row: f"line {row['line_number']} | {row['batch_external_id']}",
            )

            if missing_batches and not args.skip_missing:
                conn.rollback()
                raise RuntimeError(
                    "Preflight failed: CSV references batches not in DB. "
                    "Pass --skip-missing to skip them (staging)."
                )

            if not args.execute:
                conn.rollback()
                print("\ndry run only. Re-run with --execute to write metadata.")
                return

            updated = apply_updates(cur, to_update)
            conn.commit()
            print(f"\ndone. updated={updated}, skipped_no_attributes={len(no_attributes)}")


if __name__ == "__main__":
    main()
