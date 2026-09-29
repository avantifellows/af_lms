import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";
import { resolvePerformanceProgram } from "@/lib/performance-program";
import { isPmuRole } from "@/lib/constants";
import {
  PROGRAM_ID_TO_LABEL,
  getProgramContextSync,
  getUserPermission,
} from "@/lib/permissions";

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
    // PMU roles use the pinned program context (JNV NVS only), never the
    // row's raw program_ids.
    const session = await getServerSession(authOptions);
    let programs = allPrograms;
    if (auth.permission && isPmuRole(auth.permission.role)) {
      const allowedLabels = labelsFor(getProgramContextSync(auth.permission).programIds);
      programs = allPrograms.filter((p) => allowedLabels.has(p));
    } else if (session?.user?.email) {
      const permission = await getUserPermission(session.user.email);
      if (permission && permission.role !== "admin") {
        const allowedLabels = labelsFor(permission.program_ids || []);
        programs = allPrograms.filter((p) => allowedLabels.has(p));
      }
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
