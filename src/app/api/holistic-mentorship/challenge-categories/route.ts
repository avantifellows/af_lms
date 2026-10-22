import { NextResponse } from "next/server";

import {
  formatHolisticChallengeCategoryHeatmapCsv,
  getHolisticChallengeCategoryHeatmap,
  type ChallengeCategoryHeatmap,
  type HolisticChallengeCategoryHeatmapFilters,
} from "@/lib/holistic-challenge-category-heatmap";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { holisticProgramId, holisticRouteAccess, positiveIntegerString } from "../route-helpers";

const INVALID_FILTERS = { error: "Invalid Challenge Category Heatmap filters" };

type RequestedFilters = Omit<HolisticChallengeCategoryHeatmapFilters, "programIds" | "allPrograms"> & {
  programId: number | "all";
  csv: boolean;
};

// `program_id=all` is the viewer's scoped Holistic Programs; it has no Phase.
function filtersFrom(request: Request): RequestedFilters | null {
  const params = new URL(request.url).searchParams;
  const rawProgramId = params.get("program_id");
  const programId = rawProgramId === "all" ? "all" : holisticProgramId(rawProgramId);
  const academicYear = params.get("academic_year") ?? "";
  const rawGrade = params.get("grade");
  const grade = rawGrade === "11" ? 11 : rawGrade === "12" ? 12 : null;
  const rawPhaseId = params.get("phase_id");
  const phaseId = rawPhaseId === null || rawPhaseId === "" ? null : positiveIntegerString(rawPhaseId);
  const format = params.get("format");
  if (!programId || !validateAcademicYear(academicYear) || grade === null ||
      (rawPhaseId && phaseId === null) || (programId === "all" && rawPhaseId !== null) ||
      (format !== null && format !== "csv")) {
    return null;
  }
  return { programId, academicYear, grade, phaseId, csv: format === "csv" };
}

// e.g. challenge-categories-2026-2027-grade-11-program-1-phase-2.csv; the Phase is its Plan number.
function csvFilename(heatmap: ChallengeCategoryHeatmap, allPrograms: boolean) {
  const program = allPrograms ? "all-programs" : `program-${heatmap.programIds[0]}`;
  const phaseNumber = heatmap.phases.find(({ id }) => id === heatmap.phaseId)?.number;
  const phase = phaseNumber === undefined ? "all-phases" : `phase-${phaseNumber}`;
  return `challenge-categories-${heatmap.academicYear}-grade-${heatmap.grade}-${program}-${phase}.csv`;
}

async function heatmapResponse(request: Request) {
  const requested = filtersFrom(request);
  if (!requested) return NextResponse.json(INVALID_FILTERS, { status: 422 });
  const { programId, csv, ...filters } = requested;
  const allPrograms = programId === "all";
  const access = await holisticRouteAccess(
    "program_read",
    allPrograms ? undefined : { programId },
  );
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const heatmap = await getHolisticChallengeCategoryHeatmap({
    ...filters,
    programIds: allPrograms ? access.programIds ?? [] : [programId],
    allPrograms,
  }, access.permission);
  if (!heatmap) return NextResponse.json(INVALID_FILTERS, { status: 422 });
  if (csv) {
    return new NextResponse(formatHolisticChallengeCategoryHeatmapCsv(heatmap), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(heatmap, allPrograms)}"`,
      },
    });
  }
  return NextResponse.json(heatmap);
}

export async function GET(request: Request) {
  try {
    return await heatmapResponse(request);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
    console.error("Failed to load Challenge Category Heatmap", { code });
    return NextResponse.json(
      { error: "Unable to load Challenge Categories. Please try again." },
      { status: 500 },
    );
  }
}
