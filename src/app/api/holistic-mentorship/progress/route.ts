import { NextResponse } from "next/server";

import {
  formatHolisticProgressCsv,
  getHolisticProgressOptions,
  listHolisticProgress,
  type HolisticProgress,
  type HolisticProgressDirection,
  type HolisticProgressFilters,
  type HolisticProgressSort,
} from "@/lib/holistic-progress";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { holisticRouteAccess } from "../route-helpers";

const SORTS = new Set<HolisticProgressSort>(["student_name", "school", "grade", "mentor", "phase", "progress"]);
const PROGRESS = new Set<HolisticProgress>(["pending", "completed", "skipped", "no_active_phase"]);

type Parsed<T> = { valid: true; value: T } | { valid: false; value: null };

function parsed<T>(value: T): Parsed<T> {
  return { valid: true, value };
}

const INVALID: Parsed<never> = { valid: false, value: null };

function positiveInteger(value: string | null, fallback: number | null = null): Parsed<number | null> {
  if (value === null || value === "") return parsed(fallback);
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? parsed(number) : INVALID;
}

function optionalGrade(value: string | null): Parsed<11 | 12 | null> {
  if (value === null || value === "") return parsed(null);
  const grade = Number(value);
  return grade === 11 || grade === 12 ? parsed(grade) : INVALID;
}

function optionalSchool(value: string | null): Parsed<string | null> {
  if (value === null || value === "") return parsed(null);
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? parsed(value) : INVALID;
}

function optionalEnum<T extends string>(
  value: string | null,
  allowed: ReadonlySet<T>,
  fallback: T | null = null
): Parsed<T | null> {
  if (value === null || value === "") return parsed(fallback);
  return allowed.has(value as T) ? parsed(value as T) : INVALID;
}

function enumWithDefault<T extends string>(
  value: string | null,
  allowed: ReadonlySet<T>,
  fallback: T
): Parsed<T> {
  if (value === null) return parsed(fallback);
  return allowed.has(value as T) ? parsed(value as T) : INVALID;
}

function optionalFormat(value: string | null): Parsed<"csv" | null> {
  if (value === null) return parsed(null);
  return value === "csv" ? parsed(value) : INVALID;
}

function filtersFrom(request: Request): { filters: HolisticProgressFilters; csv: boolean } | null {
  const params = new URL(request.url).searchParams;
  const academicYear = params.get("academic_year") ?? "";
  const page = positiveInteger(params.get("page"), 1);
  const phaseId = positiveInteger(params.get("phase_id"));
  const mentorUserId = positiveInteger(params.get("mentor_user_id"));
  const grade = optionalGrade(params.get("grade"));
  const progress = optionalEnum(params.get("progress"), PROGRESS);
  const sort = enumWithDefault(params.get("sort"), SORTS, "student_name");
  const directions = new Set<HolisticProgressDirection>(["asc", "desc"]);
  const direction = enumWithDefault(params.get("direction"), directions, "asc");
  const format = optionalFormat(params.get("format"));
  const schoolCode = optionalSchool(params.get("school_code"));
  const search = (params.get("search") ?? "").trim();
  const values = [page, phaseId, mentorUserId, grade, progress, sort, direction, format, schoolCode];
  if (!validateAcademicYear(academicYear) || search.length > 100 || values.some(({ valid }) => !valid)) {
    return null;
  }
  return {
    filters: {
      academicYear,
      phaseId: phaseId.value,
      schoolCode: schoolCode.value,
      grade: grade.value,
      mentorUserId: mentorUserId.value,
      progress: progress.value,
      search,
      sort: sort.value!,
      direction: direction.value!,
      page: page.value!,
    },
    csv: format.value === "csv",
  };
}

export async function GET(request: Request) {
  const access = await holisticRouteAccess("program_read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const parsedRequest = filtersFrom(request);
  if (!parsedRequest) return NextResponse.json({ error: "Invalid progress filters" }, { status: 422 });
  const { filters, csv } = parsedRequest;
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
