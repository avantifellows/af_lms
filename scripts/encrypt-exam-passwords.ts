// fallow-ignore-file unused-file
// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Last updated: 2026-11-16. One-off script — if the schema or app has moved on
 * since this date, review/update it before running.
 *
 * Re-encrypt the exam-portal passwords still stored as plaintext in
 * `student_exam_record.application_password` into KMS ciphertext in
 * `application_password_ciphertext`, so the plaintext column can be dropped.
 *
 * Each row is encrypted with the same key and Student-bound context the app
 * uses, decrypted again to prove the round trip, and only then written —
 * through the DB Service, which wipes the plaintext on any write that carries
 * the ciphertext. A row that fails any step is left exactly as it was.
 *
 * Safety:
 *   - Dry-run by default: counts the rows and lists their ids. It never reads a
 *     password, and nothing is printed that could reveal one, in either mode.
 *   - Only rows with plaintext and no ciphertext are touched, so a re-run
 *     resumes where the last one stopped.
 *   - --limit=N caps an --apply run, to try a handful first.
 *
 * Needs DATABASE_*, DB_SERVICE_URL / DB_SERVICE_TOKEN and EXAM_PASSWORD_KMS_*
 * in the env file.
 *
 * Usage (from af_lms repo root):
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/encrypt-exam-passwords.ts --env-file=.env.production
 *   ... --apply --limit=5 --env-file=.env.production   # try five
 *   ... --apply --env-file=.env.production             # the rest
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import {
  decryptExamPassword,
  encryptExamPassword,
} from "../src/lib/exam-password-crypto";

interface Opts {
  apply: boolean;
  envFile: string;
  limit: number | null;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { apply: false, envFile: ".env.local", limit: null };
  for (const a of argv) {
    if (a === "--apply") o.apply = true;
    else if (a === "--dry-run") o.apply = false;
    else if (a.startsWith("--env-file=")) o.envFile = a.slice(11);
    else if (a.startsWith("--limit=")) {
      const n = Number(a.slice(8));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer`);
      o.limit = n;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

interface PendingRow {
  id: string;
  student_id: string;
}

const PENDING_WHERE = `application_password IS NOT NULL
  AND application_password <> ''
  AND application_password_ciphertext IS NULL`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function writeCiphertext(recordId: number, ciphertext: string): Promise<void> {
  const res = await fetch(`${requireEnv("DB_SERVICE_URL")}/student-exam-record/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${requireEnv("DB_SERVICE_TOKEN")}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      application_password: null,
      application_password_ciphertext: ciphertext,
    }),
  });
  if (!res.ok) throw new Error(`DB Service PATCH failed (${res.status})`);
  const body = (await res.json()) as {
    application_password?: string | null;
    application_password_ciphertext?: string | null;
  };
  // A DB Service without the ciphertext column would answer 200 and drop the
  // field; refuse to count that as done.
  if (body.application_password_ciphertext !== ciphertext || body.application_password != null) {
    throw new Error("DB Service did not store the ciphertext (is its migration deployed?)");
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  dotenv.config({ path: opts.envFile, quiet: true });

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });

  try {
    const pending = (
      await pool.query<PendingRow>(
        `SELECT id, student_id FROM student_exam_record WHERE ${PENDING_WHERE} ORDER BY id`,
      )
    ).rows;

    console.log(`${pending.length} registration(s) still hold a plaintext password.`);
    if (pending.length === 0) return;

    const batch = opts.limit ? pending.slice(0, opts.limit) : pending;
    if (!opts.apply) {
      console.log(`Record ids: ${batch.map((row) => row.id).join(", ")}`);
      console.log("Dry run — nothing written. Re-run with --apply to encrypt.");
      return;
    }

    let done = 0;
    const failed: string[] = [];
    for (const row of batch) {
      const recordId = Number(row.id);
      const studentId = Number(row.student_id);
      try {
        // Read one plaintext at a time, re-checking it is still pending.
        const current = await pool.query<{ application_password: string }>(
          `SELECT application_password FROM student_exam_record WHERE id = $1 AND ${PENDING_WHERE}`,
          [recordId],
        );
        if (current.rows.length === 0) continue;
        const plaintext = current.rows[0].application_password;

        const ciphertext = await encryptExamPassword(plaintext, studentId);
        if ((await decryptExamPassword(ciphertext, studentId)) !== plaintext) {
          throw new Error("round trip did not return the stored password");
        }
        await writeCiphertext(recordId, ciphertext);
        done += 1;
      } catch (error) {
        // The error never carries the password: KMS/DB Service messages only.
        failed.push(`${row.id} (${error instanceof Error ? error.message : "unknown error"})`);
      }
    }

    console.log(`Encrypted ${done} of ${batch.length}.`);
    if (failed.length) {
      console.log(`Left unchanged: ${failed.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
