import { NextResponse } from "next/server";

import {
  getHolisticChallengeCategoryHeatmap,
  type HolisticChallengeCategoryHeatmapFilters,
} from "@/lib/holistic-challenge-category-heatmap";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { holisticProgramId, holisticRouteAccess, positiveIntegerString } from "../route-helpers";

const INVALID_FILTERS = { error: "Invalid Challenge Category Heatmap filters" };

function filtersFrom(request: Request): HolisticChallengeCategoryHeatmapFilters | null {
  const params = new URL(request.url).searchParams;
  const programId = holisticProgramId(params.get("program_id"));
  const academicYear = params.get("academic_year") ?? "";
  const rawGrade = params.get("grade");
  const grade = rawGrade === "11" ? 11 : rawGrade === "12" ? 12 : null;
  const rawPhaseId = params.get("phase_id");
  const phaseId = rawPhaseId === null || rawPhaseId === "" ? null : positiveIntegerString(rawPhaseId);
  if (!programId || !validateAcademicYear(academicYear) || grade === null ||
      (rawPhaseId && phaseId === null)) {
    return null;
  }
  return { programId, academicYear, grade, phaseId };
}

async function heatmapResponse(request: Request) {
  const filters = filtersFrom(request);
  if (!filters) return NextResponse.json(INVALID_FILTERS, { status: 422 });
  const access = await holisticRouteAccess("program_read", { programId: filters.programId });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const heatmap = await getHolisticChallengeCategoryHeatmap(filters, access.permission);
  if (!heatmap) return NextResponse.json(INVALID_FILTERS, { status: 422 });
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
