import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import { BLENDED_MENTOR_ROLE, CURRENT_ACADEMIC_YEAR } from "./constants";

// Operator loader for Blended Learning Supervisions (server-only; run through
// scripts/load-blended-learning-supervisions.ts, runbook
// .mex/patterns/load-blended-learning-supervisions.md). A Supervision lets a
// team-lead Mentor view, read-only, another Mentor's Students this academic
// year. Pairs come in as emails, never in code. Dry run by default; an apply
// writes every pair in one transaction, and writes nothing when any pair is
// blocked.

export type SupervisionPair = { supervisorEmail: string; mentorEmail: string };
export type SupervisionLoadMode = "dry-run" | "apply";
// Start the Supervisions, or end the running ones.
export type SupervisionLoadAction = "start" | "end";

export type PairOutcome =
  | "insert"
  | "unchanged"
  | "end"
  | "not_running"
  | "supervisor_not_a_mentor"
  | "mentor_not_a_mentor"
  | "supervisor_no_user"
  | "mentor_no_user"
  | "same_person";

const BLOCKING: ReadonlySet<PairOutcome> = new Set([
  "supervisor_not_a_mentor",
  "mentor_not_a_mentor",
  "supervisor_no_user",
  "mentor_no_user",
  "same_person",
]);

export type PairReport = SupervisionPair & {
  outcome: PairOutcome;
  supervisorUserId: number | null;
  mentorUserId: number | null;
  // The Mentor's active current-year Mappings: what the supervisor will see.
  menteeCount: number;
};

export type SupervisionLoadReport = {
  mode: SupervisionLoadMode;
  action: SupervisionLoadAction;
  academicYear: string;
  pairs: PairReport[];
  // Rows inserted or ended (0 on a dry run, or when any pair is blocked).
  written: number;
  blocked: boolean;
};

const SOURCE = "af_lms_script";
const END_REASON = "supervision_ended";
const EMAIL = /^[^\s@:,]+@[^\s@:,]+\.[^\s@:,]+$/;

// "<supervisor email>:<mentor email>", as the --pair flag takes it.
export function parseSupervisionPair(value: string): SupervisionPair {
  const [supervisorEmail = "", mentorEmail = "", ...rest] = value.split(":").map((part) => part.trim());
  if (rest.length > 0 || !EMAIL.test(supervisorEmail) || !EMAIL.test(mentorEmail)) {
    throw new Error(`--pair must be <supervisor email>:<mentor email>, got "${value}".`);
  }
  return { supervisorEmail, mentorEmail };
}

type Person = { userId: number | null; isMentor: boolean };

// A live Blended Learning Mentor's `user` id, resolved as the app resolves it
// (user_permission.user_id, else the lowest-id `user` row with that email),
// so the Supervision points at the id their Mappings use.
async function resolvePerson(email: string): Promise<Person> {
  const rows = await query<{ role: string | null; user_id: number | string | null }>(
    `SELECT permission.role,
            COALESCE(permission.user_id,
                     (SELECT account.id FROM "user" account
                      WHERE LOWER(account.email) = LOWER(permission.email) ORDER BY account.id LIMIT 1)) AS user_id
     FROM user_permission permission
     WHERE LOWER(permission.email) = LOWER($1) AND permission.revoked_at IS NULL
     LIMIT 1`,
    [email]
  );
  const row = rows[0];
  return {
    userId: row?.user_id == null ? null : Number(row.user_id),
    isMentor: row?.role === BLENDED_MENTOR_ROLE,
  };
}

function blockedOutcome(supervisor: Person, mentor: Person): PairOutcome | null {
  if (!supervisor.isMentor) return "supervisor_not_a_mentor";
  if (!mentor.isMentor) return "mentor_not_a_mentor";
  if (supervisor.userId === null) return "supervisor_no_user";
  if (mentor.userId === null) return "mentor_no_user";
  return supervisor.userId === mentor.userId ? "same_person" : null;
}

async function isRunning(supervisorUserId: number, mentorUserId: number): Promise<boolean> {
  const rows = await query<{ id: number | string }>(
    `SELECT supervision.id FROM blended_learning_mentor_supervisions supervision
     WHERE supervision.supervisor_user_id = $1 AND supervision.mentor_user_id = $2
       AND supervision.academic_year = $3 AND supervision.ended_at IS NULL
     LIMIT 1`,
    [supervisorUserId, mentorUserId, CURRENT_ACADEMIC_YEAR]
  );
  return rows.length > 0;
}

async function menteeCount(mentorUserId: number | null): Promise<number> {
  if (mentorUserId === null) return 0;
  const rows = await query<{ count: number | string }>(
    `SELECT count(*) AS count FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.mentor_user_id = $1 AND mapping.academic_year = $2 AND mapping.ended_at IS NULL`,
    [mentorUserId, CURRENT_ACADEMIC_YEAR]
  );
  return Number(rows[0]?.count ?? 0);
}

async function planPair(pair: SupervisionPair, action: SupervisionLoadAction): Promise<PairReport> {
  const [supervisor, mentor] = await Promise.all([resolvePerson(pair.supervisorEmail), resolvePerson(pair.mentorEmail)]);
  const base = { ...pair, supervisorUserId: supervisor.userId, mentorUserId: mentor.userId };
  const count = await menteeCount(mentor.userId);
  const blocked = blockedOutcome(supervisor, mentor);
  if (blocked) return { ...base, outcome: blocked, menteeCount: count };

  const running = await isRunning(supervisor.userId as number, mentor.userId as number);
  const outcome: PairOutcome = action === "start" ? (running ? "unchanged" : "insert") : running ? "end" : "not_running";
  return { ...base, outcome, menteeCount: count };
}

async function insertSupervision(client: PoolClient, pair: PairReport, by: string, reason: string | null) {
  const result = await client.query(
    `INSERT INTO blended_learning_mentor_supervisions
       (supervisor_user_id, mentor_user_id, academic_year, started_at,
        assigned_by_email, assignment_source, assignment_audit_reason)
     VALUES ($1, $2, $3, date_trunc('second', now() AT TIME ZONE 'UTC'), $4, $5, $6)
     ON CONFLICT (supervisor_user_id, mentor_user_id, academic_year) WHERE ended_at IS NULL DO NOTHING
     RETURNING id`,
    [pair.supervisorUserId, pair.mentorUserId, CURRENT_ACADEMIC_YEAR, by, SOURCE, reason]
  );
  return result.rows.length;
}

async function endSupervision(client: PoolClient, pair: PairReport, by: string, reason: string | null) {
  const result = await client.query(
    `UPDATE blended_learning_mentor_supervisions
     SET ended_at = GREATEST(started_at, date_trunc('second', now() AT TIME ZONE 'UTC')),
         ended_by_email = $4, end_source = $5, end_reason = $6, end_audit_reason = $7, updated_at = now()
     WHERE supervisor_user_id = $1 AND mentor_user_id = $2 AND academic_year = $3 AND ended_at IS NULL
     RETURNING id`,
    [pair.supervisorUserId, pair.mentorUserId, CURRENT_ACADEMIC_YEAR, by, SOURCE, END_REASON, reason]
  );
  return result.rows.length;
}

async function writePairs(pairs: PairReport[], by: string, reason: string | null): Promise<number> {
  return withTransaction(async (client) => {
    let written = 0;
    for (const pair of pairs) {
      if (pair.outcome === "insert") written += await insertSupervision(client, pair, by, reason);
      if (pair.outcome === "end") written += await endSupervision(client, pair, by, reason);
    }
    return written;
  });
}

export async function runSupervisionsLoad(params: {
  pairs: SupervisionPair[];
  mode: SupervisionLoadMode;
  action: SupervisionLoadAction;
  // The operator's email, recorded as assigned_by_email / ended_by_email.
  by: string;
  reason?: string | null;
}): Promise<SupervisionLoadReport> {
  if (params.pairs.length === 0) throw new Error("Give at least one --pair.");
  if (!EMAIL.test(params.by)) throw new Error("--by must be the operator's email.");
  const reason = params.reason?.trim() || null;

  const pairs: PairReport[] = [];
  for (const pair of params.pairs) pairs.push(await planPair(pair, params.action));
  const blocked = pairs.some((pair) => BLOCKING.has(pair.outcome));
  const written = params.mode === "apply" && !blocked ? await writePairs(pairs, params.by, reason) : 0;
  return { mode: params.mode, action: params.action, academicYear: CURRENT_ACADEMIC_YEAR, pairs, written, blocked };
}

export function formatSupervisionsLoadReport(report: SupervisionLoadReport): string[] {
  const lines = [`Blended Learning Supervisions, ${report.academicYear}: ${report.action} (${report.mode})`];
  for (const pair of report.pairs) {
    lines.push(
      `  ${pair.supervisorEmail} -> ${pair.mentorEmail}: ${pair.outcome}` +
        ` (user ${pair.supervisorUserId ?? "?"} -> ${pair.mentorUserId ?? "?"}; mentor has ${pair.menteeCount} active mentees)`
    );
  }
  if (report.blocked) lines.push("Blocked: fix the pairs above. Nothing was written.");
  else if (report.mode === "dry-run") lines.push("Dry run: nothing was written. Re-run with --apply to write.");
  else lines.push(`Applied: ${report.written} row(s) written in one transaction.`);
  return lines;
}
