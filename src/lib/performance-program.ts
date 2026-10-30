import { NextResponse } from "next/server";
import {
  PMU_PROGRAM_ID,
  PROGRAM_ID_TO_LABEL,
  isPmuRole,
} from "@/lib/constants";

type PerformanceProgram =
  | { ok: true; program: string | undefined }
  | { ok: false; response: NextResponse };

// PMU roles are pinned to JNV NVS on every Performance (quiz-analytics) API
// (ADR 0007): a missing program becomes "JNV NVS" and any other program is
// refused, so editing the URL can't read another Program's results. Every
// other caller gets the requested program back unchanged.
export function resolvePerformanceProgram(
  permission: { role: string } | null | undefined,
  requested: string | undefined,
): PerformanceProgram {
  if (!permission || !isPmuRole(permission.role)) {
    return { ok: true, program: requested };
  }
  const pinned = PROGRAM_ID_TO_LABEL[PMU_PROGRAM_ID];
  if (requested === undefined || requested === pinned) {
    return { ok: true, program: pinned };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
  };
}

/**
 * The Performance programs (BigQuery `student_program` labels) a caller may
 * read: "all" for admins (read-only too) and a caller with no permission row,
 * the pinned JNV NVS for PMU roles, else the labels of the row's program_ids.
 * The same filter the grades route applies to the programs it offers (which
 * MCP's program guard reads): keep the two in step.
 */
export function performancePrograms(
  permission: { role: string; program_ids?: number[] | null } | null | undefined,
): "all" | Set<string> {
  if (!permission || permission.role === "admin") return "all";
  if (isPmuRole(permission.role)) return new Set([PROGRAM_ID_TO_LABEL[PMU_PROGRAM_ID]]);
  return new Set(
    (permission.program_ids ?? [])
      .map((id) => PROGRAM_ID_TO_LABEL[id])
      .filter((label): label is string => Boolean(label)),
  );
}
