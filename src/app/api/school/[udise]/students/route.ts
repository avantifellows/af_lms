import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import {
  buildStudentAdditionTemplateWorkbook,
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
  program_ids: number[] | null;
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
    `SELECT id, code, udise_code, region, program_ids
     FROM school
     WHERE udise_code = $1 OR code = $1
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
}: {
  access: StudentAdditionAccess;
  school: RouteSchool;
  rows: LmsStudentAdditionRow[];
  upload: { id: string; filename: string };
}) {
  const dbServiceUrl = process.env.DB_SERVICE_URL;
  const dbServiceToken = process.env.DB_SERVICE_TOKEN;
  if (!dbServiceUrl || !dbServiceToken) {
    return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
  }

  const period = deriveLmsEnrollmentPeriod();
  const response = await fetch(`${dbServiceUrl}/api/lms/students/bulk-create-with-enrollments`, {
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
    const details = await response.text();
    return NextResponse.json(
      { error: "Failed to create student", details },
      { status: response.status },
    );
  }

  return NextResponse.json(await response.json());
}

async function bulkUploadResponse(
  request: NextRequest,
  access: StudentAdditionAccess,
  school: RouteSchool,
) {
  const form = await request.formData();
  const file = form.get("file");
  const selectedGrade = Number(form.get("grade"));
  if (selectedGrade !== 11 && selectedGrade !== 12) {
    return NextResponse.json({ error: "Select Grade 11 or 12 before upload" }, { status: 400 });
  }
  if (!isUploadFile(file)) {
    return NextResponse.json({ error: "Upload a .xlsx or rejected-row .csv file" }, { status: 400 });
  }

  const parsed = await parseStudentAdditionUpload({
    filename: uploadFilename(file),
    data: Buffer.from(await file.arrayBuffer()),
    selectedGrade,
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
  const session = await getServerSession(authOptions);
  const { udise } = await params;

  const resolved = await resolveSchoolAndAccess(session, udise);
  if (resolved.response) return resolved.response;
  const { school, access } = resolved;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return bulkUploadResponse(request, access, school);
  }

  const body = await request.json();
  const validation = validateStudentAdditionInput(body, { rowNumber: 1 });
  if (!validation.ok) return validationResponse(validation);
  return proxyRowsToDbService({
    access,
    school,
    rows: [validation.row],
    upload: {
      id: `single-student-${Date.now()}`,
      filename: "one-by-one",
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const session = await getServerSession(authOptions);
  const { udise } = await params;
  const resolved = await resolveSchoolAndAccess(session, udise);
  if (resolved.response) return resolved.response;

  const workbook = await buildStudentAdditionTemplateWorkbook();
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="lms-student-addition-template.xlsx"',
    },
  });
}
