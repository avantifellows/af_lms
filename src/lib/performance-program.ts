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
