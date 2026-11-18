import { ADMIN_SESSION } from "./api-test-helpers";

// Fixtures for the Exams tab routes, which all pass through `gateExamRecords`
// (`src/lib/exam-records-gate.ts`) against a mocked `query`.

interface ResolvesOnce {
  mockResolvedValueOnce(value: unknown): unknown;
}
interface Resolves {
  mockResolvedValue(value: unknown): unknown;
}

/** A `user_permission` row; read-only defaults to a scoped program_admin. */
export function examRecordsPermissionRow({
  readOnly = false,
  role = readOnly ? "program_admin" : "admin",
}: { readOnly?: boolean; role?: string } = {}) {
  return {
    email: "admin@avantifellows.org",
    level: 3,
    role,
    school_codes: null,
    regions: null,
    program_ids: readOnly ? [1] : null,
    read_only: readOnly,
  };
}

/**
 * Sign in and queue the three queries the gate runs: the Student's school, the
 * permission, then `isPmuOnlyStudent` — which the Student fails by default,
 * being a physical-centre Student with a current non-NVS batch.
 */
export function queueExamRecordsGate(
  session: Resolves,
  query: ResolvesOnce,
  { readOnly = false, pmuOnly = false }: { readOnly?: boolean; pmuOnly?: boolean } = {},
): void {
  session.mockResolvedValue(ADMIN_SESSION);
  query.mockResolvedValueOnce([{ code: "12345", region: "West", program_id: 1 }]);
  query.mockResolvedValueOnce([examRecordsPermissionRow({ readOnly })]);
  query.mockResolvedValueOnce([
    pmuOnly ? { nvs: true, other: false } : { nvs: false, other: true },
  ]);
}
