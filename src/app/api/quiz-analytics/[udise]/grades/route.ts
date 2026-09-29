import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";
import { resolvePerformanceProgram } from "@/lib/performance-program";
import { PROGRAM_ID_TO_LABEL, isPmuRole } from "@/lib/constants";

function labelsFor(programIds: number[]): Set<string> {
  return new Set(
    programIds
      .map((id) => PROGRAM_ID_TO_LABEL[id])
      .filter((label): label is string => Boolean(label))
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const pinned = resolvePerformanceProgram(
    auth.permission,
    url.searchParams.get("program") || undefined
  );
  if (!pinned.ok) return pinned.response;
  const program = pinned.program;

  try {
    const [grades, allPrograms] = await Promise.all([
      getAvailableGrades(udise, program),
      getAvailablePrograms(udise),
    ]);

    // Restrict program tabs to the ones the user is assigned to.
    // Admins see every program available for the school.
    // PMU roles see only their pinned program (JNV NVS), never the row's raw
    // program_ids.
    const permission = auth.permission;
    let programs = allPrograms;
    if (permission && isPmuRole(permission.role)) {
      programs = allPrograms.filter((p) => p === program);
    } else if (permission && permission.role !== "admin") {
      const allowedLabels = labelsFor(permission.program_ids || []);
      programs = allPrograms.filter((p) => allowedLabels.has(p));
    }

    return NextResponse.json({ grades, programs });
  } catch (error) {
    console.error("Grades fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch available grades" },
      { status: 500 }
    );
  }
}
