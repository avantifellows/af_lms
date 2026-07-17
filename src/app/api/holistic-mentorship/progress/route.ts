import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  formatHolisticProgressCsv,
  getHolisticProgressOptions,
  listHolisticProgress,
  type HolisticProgress,
  type HolisticProgressDirection,
  type HolisticProgressFilters,
  type HolisticProgressSort,
} from "@/lib/holistic-progress";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";

const SORTS = new Set<HolisticProgressSort>(["student_name", "school", "grade", "mentor", "phase", "progress"]);
const PROGRESS = new Set<HolisticProgress>(["pending", "completed", "skipped", "no_active_phase"]);

function positiveInteger(value: string | null, fallback: number | null = null): number | null {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function filtersFrom(request: Request): HolisticProgressFilters | null {
  const params = new URL(request.url).searchParams;
  const academicYear = params.get("academic_year") ?? "";
  const phaseValue = params.get("phase_id");
  const mentorValue = params.get("mentor_user_id");
  const gradeValue = params.get("grade");
  const progressValue = params.get("progress");
  const sortValue = params.get("sort") ?? "student_name";
  const directionValue = params.get("direction") ?? "asc";
  const format = params.get("format");
  const page = positiveInteger(params.get("page"), 1);
  const phaseId = positiveInteger(phaseValue);
  const mentorUserId = positiveInteger(mentorValue);
  const grade = gradeValue === null || gradeValue === "" ? null : Number(gradeValue);
  const search = (params.get("search") ?? "").trim();
  const schoolCode = params.get("school_code") || null;
  if (!validateAcademicYear(academicYear) || page === null || search.length > 100 ||
      (phaseValue !== null && phaseValue !== "" && phaseId === null) ||
      (mentorValue !== null && mentorValue !== "" && mentorUserId === null) ||
      (grade !== null && grade !== 11 && grade !== 12) ||
      (schoolCode !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(schoolCode)) ||
      (progressValue !== null && progressValue !== "" && !PROGRESS.has(progressValue as HolisticProgress)) ||
      !SORTS.has(sortValue as HolisticProgressSort) || !["asc", "desc"].includes(directionValue) ||
      (format !== null && format !== "csv")) {
    return null;
  }
  return {
    academicYear, phaseId, schoolCode, grade: grade as 11 | 12 | null, mentorUserId,
    progress: (progressValue || null) as HolisticProgress | null,
    search, sort: sortValue as HolisticProgressSort,
    direction: directionValue as HolisticProgressDirection, page,
  };
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "program_read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const filters = filtersFrom(request);
  if (!filters) return NextResponse.json({ error: "Invalid progress filters" }, { status: 422 });
  const csv = new URL(request.url).searchParams.get("format") === "csv";
  const result = csv
    ? await listHolisticProgress(filters, { all: true })
    : await listHolisticProgress(filters);
  if (csv) {
    const content = new TextEncoder().encode(formatHolisticProgressCsv(filters.academicYear, result.rows));
    const stream = new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="holistic-progress-${filters.academicYear}.csv"`,
      },
    });
  }
  return NextResponse.json({
    ...result,
    options: await getHolisticProgressOptions(filters.academicYear),
    pageSize: 50,
    refreshedAt: new Date().toISOString(),
  });
}
