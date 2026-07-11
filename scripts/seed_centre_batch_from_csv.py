#!/usr/bin/env python3
"""Backfill centre <-> batch links into the centre_batch join table from the DCF CSV.

Resolves each CSV `LMS Center` name to a centres.id and links it to the batch
(by `Batch ID` -> batch.id). Rows with a blank LMS Center are skipped (a known
CSV data gap; the centre exists but the row isn't filled in).

Requires the centre_batch table to exist (db-service migration
20260710120000_create_centre_batch). Fails loudly in preflight if it doesn't,
so running before the migration lands is safe (no partial writes).

Dry-run by default. Re-run with --execute to write.
"""
import argparse
import csv
import os
from pathlib import Path

import psycopg2


DEFAULT_CSV_PATH = "tmp/DCF - 2026-2027 (JNV & EMRS) - batch_list.csv"


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


def read_rows(csv_path):
    rows = []
    skipped_blank_centre = []
    seen = set()
    duplicates = []

    with Path(csv_path).open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        required_columns = {"Batch ID", "LMS Center"}
        missing_columns = required_columns - set(reader.fieldnames or [])
        if missing_columns:
            raise RuntimeError(f"Missing required CSV columns: {sorted(missing_columns)}")

        for line_number, row in enumerate(reader, start=2):
            batch_external_id = (row.get("Batch ID") or "").strip()
            centre_name = (row.get("LMS Center") or "").strip()

            if not batch_external_id:
                raise RuntimeError(f"Missing Batch ID on CSV line {line_number}")

            if not centre_name:
                skipped_blank_centre.append((line_number, batch_external_id))
                continue

            pair = (batch_external_id, centre_name)
            if pair in seen:
                duplicates.append((line_number, batch_external_id, centre_name))
                continue
            seen.add(pair)

            rows.append(
                {
                    "line_number": line_number,
                    "batch_external_id": batch_external_id,
                    "centre_name": centre_name,
                }
            )

    return rows, skipped_blank_centre, duplicates


def fetch_one(cur, sql, params):
    cur.execute(sql, params)
    return cur.fetchone()


def require_centre_batch_table(cur):
    exists = fetch_one(
        cur,
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'centre_batch')",
        (),
    )[0]
    if not exists:
        raise RuntimeError(
            "centre_batch table does not exist. Run the db-service migration "
            "(20260710120000_create_centre_batch) against this database first."
        )


def preflight(cur, rows):
    to_insert = []
    already_linked = []
    missing_batches = []
    missing_centres = []
    ambiguous_centres = []

    for row in rows:
        batch = fetch_one(
            cur, "SELECT id FROM batch WHERE batch_id = %s", (row["batch_external_id"],)
        )
        if not batch:
            missing_batches.append(row)
            continue
        batch_pk = batch[0]

        cur.execute("SELECT id FROM centres WHERE name = %s", (row["centre_name"],))
        centre_matches = cur.fetchall()
        if not centre_matches:
            missing_centres.append(row)
            continue
        if len(centre_matches) > 1:
            ambiguous_centres.append({**row, "centre_ids": [c[0] for c in centre_matches]})
            continue
        centre_pk = centre_matches[0][0]

        existing = fetch_one(
            cur,
            "SELECT id FROM centre_batch "
            "WHERE centre_id = %s AND batch_id = %s AND deleted_at IS NULL",
            (centre_pk, batch_pk),
        )
        if existing:
            already_linked.append({**row, "centre_pk": centre_pk, "batch_pk": batch_pk})
            continue

        to_insert.append({**row, "centre_pk": centre_pk, "batch_pk": batch_pk})

    return to_insert, already_linked, missing_batches, missing_centres, ambiguous_centres


def insert_links(cur, to_insert):
    inserted = 0
    for row in to_insert:
        cur.execute(
            "INSERT INTO centre_batch (centre_id, batch_id, inserted_at, updated_at) "
            "VALUES (%s, %s, now(), now())",
            (row["centre_pk"], row["batch_pk"]),
        )
        inserted += cur.rowcount
    return inserted


def print_sample(title, items, formatter, limit=15):
    print(f"\n{title}: {len(items)}")
    for item in items[:limit]:
        print(f"  {formatter(item)}")
    if len(items) > limit:
        print(f"  ... and {len(items) - limit} more")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=DEFAULT_CSV_PATH, help="Path to DCF batch_list CSV")
    parser.add_argument("--execute", action="store_true", help="Apply inserts (default: dry run)")
    parser.add_argument(
        "--skip-missing",
        action="store_true",
        help="Tolerate CSV batches absent from the DB (skip them) instead of aborting. "
        "Use on staging, which lags prod's batch table; keep OFF on prod. Note: this "
        "only relaxes MISSING BATCHES; a missing or ambiguous CENTRE always aborts "
        "(that's a real data error, not env drift).",
    )
    args = parser.parse_args()

    load_env()

    rows, skipped_blank_centre, duplicates = read_rows(args.csv)

    with get_conn() as conn:
        with conn.cursor() as cur:
            require_centre_batch_table(cur)

            (
                to_insert,
                already_linked,
                missing_batches,
                missing_centres,
                ambiguous_centres,
            ) = preflight(cur, rows)

            print(f"csv rows with a centre: {len(rows)}")
            print_sample(
                "skipped (blank LMS Center)",
                skipped_blank_centre,
                lambda row: f"line {row[0]} | {row[1]}",
            )
            print_sample(
                "duplicate (batch, centre) pairs skipped",
                duplicates,
                lambda row: f"line {row[0]} | {row[1]} -> {row[2]}",
            )
            print_sample(
                "already linked",
                already_linked,
                lambda row: f"line {row['line_number']} | {row['batch_external_id']} -> {row['centre_name']}",
            )
            print_sample(
                "ready to insert",
                to_insert,
                lambda row: (
                    f"line {row['line_number']} | {row['batch_external_id']} "
                    f"-> {row['centre_name']} (centre_id={row['centre_pk']})"
                ),
            )
            print_sample(
                "missing batches (not in DB)",
                missing_batches,
                lambda row: f"line {row['line_number']} | {row['batch_external_id']}",
            )
            print_sample(
                "missing centres (name not in centres table)",
                missing_centres,
                lambda row: f"line {row['line_number']} | {row['centre_name']}",
            )
            print_sample(
                "AMBIGUOUS centres (name matches >1 centre)",
                ambiguous_centres,
                lambda row: f"line {row['line_number']} | {row['centre_name']} -> ids {row['centre_ids']}",
            )

            # Missing/ambiguous centres are real data errors — always abort.
            # Missing batches are env drift (staging lags prod) — abort unless
            # --skip-missing, in which case those rows were already left out of
            # to_insert by preflight and we just proceed with the rest.
            if missing_centres or ambiguous_centres:
                conn.rollback()
                raise RuntimeError(
                    "Preflight failed: missing or ambiguous centre name. No rows inserted."
                )

            if missing_batches and not args.skip_missing:
                conn.rollback()
                raise RuntimeError(
                    "Preflight failed: CSV references batches not in DB. "
                    "Pass --skip-missing to skip them (staging)."
                )

            if not args.execute:
                conn.rollback()
                print("\ndry run only. Re-run with --execute to insert links.")
                return

            inserted = insert_links(cur, to_insert)
            conn.commit()
            print(
                f"\ndone. inserted={inserted}, already_linked={len(already_linked)}, "
                f"skipped_blank={len(skipped_blank_centre)}"
            )


if __name__ == "__main__":
    main()
