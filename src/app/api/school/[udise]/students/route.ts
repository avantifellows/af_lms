import { readFile } from "fs/promises";
import path from "path";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import {
  parseStudentAdditionUpload,
  type StudentAdditionUploadRowResult,
} from "@/lib/student-addition-bulk";
import { requireStudentAdditionAccess } from "@/lib/student-addition-access";
import {
  validateStudentAdditionInput,
  type LmsStudentAdditionRow,
  type StudentAdditionValidationResult,
} from "@/lib/student-addition-fields";

interface RouteSchool {
  id: string;
  code: string;
  udise_code: string | null;
  region: string | null;
}

interface StudentAdditionAccess {
  programId: number;
  actor: {
    user_id: number | null;
    email: string;
    login_type: "google";
    role: string;
  };
}

type DbServiceResult = {
  row_number: number;
  status: "created" | "duplicate_in_file" | "already_exists" | "rejected";
  original?: Record<string, string>;
};

const EMPTY_TOTALS = {
  total: 0,
  created: 0,
  duplicate_in_file: 0,
  already_exists: 0,
  rejected: 0,
};
const MAX_STUDENT_ADDITION_UPLOAD_BYTES = 5 * 1024 * 1024;

function safeFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function safeUpstreamResults(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((result) => {
    const safe = safeFields(result, [
      "row_number", "status", "generated_student_id", "field_errors", "row_errors",
    ]) ?? {};
    const record = result as Record<string, unknown>;
    const normalized = safeFields(record.normalized, [
      "student_id", "pen_number", "student_name", "g10_roll_no",
    ]);
    const existingMatch = safeFields(record.existing_match, [
      "matched_identifier", "student_id", "pen_number", "apaar_id", "student_name",
      "school_name", "school_code", "udise_code", "district", "state", "grade", "program", "stream",
    ]);
    return {
      ...safe,
      ...(normalized ? { normalized } : {}),
      ...(existingMatch ? { existing_match: existingMatch } : {}),
    };
  });
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value;
}

function uploadFilename(file: File): string {
  if (file.name && file.name !== "blob") return file.name;
  return file.type.includes("csv") ? "upload.csv" : "upload.xlsx";
}

function validationResponse(result: StudentAdditionValidationResult) {
  return NextResponse.json(
    {
      error: "Validation failed",
      totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 0, rejected: 1 },
      results: [
        {
          row_number: 1,
          status: "rejected",
          generated_student_id: result.generatedStudentId,
          normalized: {
            student_name: result.row.student_name ?? "",
            g10_roll_no: result.row.g10_roll_no ?? "",
            student_id: result.generatedStudentId,
          },
          field_errors: result.fieldErrors,
          row_errors: result.rowErrors,
          existing_match: null,
        },
      ],
    },
    { status: 400 },
  );
}

async function resolveSchoolAndAccess(
  session: Parameters<typeof requireStudentAdditionAccess>[0],
  udise: string,
) {
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const schools = await query<RouteSchool>(
    `SELECT
       sch.id,
       sch.code,
       sch.udise_code,
       sch.region
     FROM school sch
     WHERE sch.udise_code = $1 OR sch.code = $1
     LIMIT 1`,
    [udise],
  );
  const school = schools[0];
  if (!school) {
    return { response: NextResponse.json({ error: "School not found" }, { status: 404 }) };
  }

  const access = await requireStudentAdditionAccess(session, school);
  if (!access.ok) {
    return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }

  return { school, access };
}

async function resolveRouteContext(params: Promise<{ udise: string }>) {
  const session = await getServerSession(authOptions);
  const { udise } = await params;
  return resolveSchoolAndAccess(session, udise);
}

function countTotals(results: Array<{ status: DbServiceResult["status"] }>) {
  return results.reduce(
    (totals, result) => ({
      ...totals,
      total: totals.total + 1,
      [result.status]: totals[result.status] + 1,
    }),
    { ...EMPTY_TOTALS },
  );
}

async function proxyRowsToDbService({
  access,
  school,
  rows,
  upload,
  period,
}: {
  access: StudentAdditionAccess;
  school: RouteSchool;
  rows: LmsStudentAdditionRow[];
  upload: { id: string; filename: string };
  period: ReturnType<typeof deriveLmsEnrollmentPeriod>;
}) {
  const dbServiceUrl = process.env.DB_SERVICE_URL?.replace(/\/+$/, "");
  const dbServiceToken = process.env.DB_SERVICE_TOKEN;
  if (!dbServiceUrl || !dbServiceToken) {
    return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
  }

  const response = await fetch(`${dbServiceUrl}/lms/students/bulk-create-with-enrollments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dbServiceToken}`,
    },
    body: JSON.stringify({
      actor: access.actor,
      school: { code: school.code, udise_code: school.udise_code },
      program_id: access.programId,
      upload,
      ...period,
      rows,
    }),
  });

  if (!response.ok) {
    const upstream = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null) as Record<string, unknown> | null
      : null;
    return NextResponse.json(
      {
        error: "Student could not be created",
        ...(upstream?.field_errors ? { field_errors: upstream.field_errors } : {}),
        ...(upstream?.row_errors ? { row_errors: upstream.row_errors } : {}),
        ...(upstream?.results ? { results: safeUpstreamResults(upstream.results) } : {}),
      },
      { status: response.status },
    );
  }

  return NextResponse.json(await response.json());
}

// fallow-ignore-next-line complexity
async function bulkUploadResponse(
  request: NextRequest,
  access: StudentAdditionAccess,
  school: RouteSchool,
) {
  const form = await request.formData();
  const file = form.get("file");
  if (!isUploadFile(file)) {
    return NextResponse.json({ error: "Upload a .xlsx or rejected-row .csv file" }, { status: 400 });
  }
  if (file.size > MAX_STUDENT_ADDITION_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Upload file is too large. Max size is 5 MB." }, { status: 400 });
  }

  const period = deriveLmsEnrollmentPeriod();
  const parsed = await parseStudentAdditionUpload({
    filename: uploadFilename(file),
    data: Buffer.from(await file.arrayBuffer()),
    academicYear: period.academic_year,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.totalRows === 0) {
    return NextResponse.json({ error: "Upload has no student rows" }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { totals: countTotals(parsed.rejectedResults), results: parsed.rejectedResults },
      { status: 400 },
    );
  }

  const response = await proxyRowsToDbService({
    access,
    school,
    rows: parsed.rows,
    upload: {
      id: `student-bulk-${Date.now()}`,
      filename: uploadFilename(file),
    },
    period,
  });
  if (response.status !== 200) return response;

  const body = await response.json();
  const dbResults = (body.results ?? []).map((result: DbServiceResult) => ({
    ...result,
    original: parsed.originalRows.get(result.row_number) ?? {},
  }));
  const results = [...dbResults, ...parsed.rejectedResults].sort(
    (a, b) => (a.row_number ?? 0) - (b.row_number ?? 0),
  ) as Array<DbServiceResult | StudentAdditionUploadRowResult>;

  return NextResponse.json({
    ...body,
    totals: countTotals(results),
    results,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const resolved = await resolveRouteContext(params);
  if (resolved.response) return resolved.response;
  const { school, access } = resolved;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return bulkUploadResponse(request, access, school);
  }

  const body = await request.json();
  const period = deriveLmsEnrollmentPeriod();
  const validation = validateStudentAdditionInput(body, {
    rowNumber: 1,
    academicYear: period.academic_year,
  });
  if (!validation.ok) return validationResponse(validation);
  return proxyRowsToDbService({
    access,
    school,
    rows: [validation.row],
    upload: {
      id: `single-student-${Date.now()}`,
      filename: "one-by-one",
    },
    period,
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const resolved = await resolveRouteContext(params);
  if (resolved.response) return resolved.response;

  const workbook = await readFile(path.join(process.cwd(), "src", "assets", "nvs-student-addition-template.xlsx"));
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="nvs-student-addition-template.xlsx"',
    },
  });
}
