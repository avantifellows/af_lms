import { readFile } from "fs/promises";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import {
  ACTIVE_REGISTRATION_MODE,
} from "@/lib/registration-mode";
import {
  parseStudentAdditionUpload,
} from "@/lib/student-addition-bulk";
import {
  requireStudentAdditionAccess,
  type StudentAdditionSchool,
} from "@/lib/student-addition-access";
import {
  validateStudentAdditionInput,
} from "@/lib/student-addition-fields";

import {
  countStudentAdditionTotals,
  MAX_STUDENT_ADDITION_UPLOAD_BYTES,
  mergeStudentAdditionResults,
  proxyStudentAdditionRows,
  STUDENT_ADDITION_TEMPLATE_FILENAMES,
  studentAdditionTemplatePath,
  studentAdditionValidationBody,
} from "@/lib/student-addition-api";

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

async function resolveSchoolAndAccess(
  session: Parameters<typeof requireStudentAdditionAccess>[0],
  udise: string,
) {
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const schools = await query<StudentAdditionSchool>(
    `SELECT
       sch.id,
       sch.code,
       sch.udise_code,
       sch.region,
       sch.af_school_category
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

async function bulkUploadResponse(
  request: NextRequest,
  access: Awaited<ReturnType<typeof requireStudentAdditionAccess>> & { ok: true },
  school: StudentAdditionSchool,
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
    mode: ACTIVE_REGISTRATION_MODE,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.totalRows === 0) {
    if (parsed.ignoredRows.length > 0) {
      return NextResponse.json(
        {
          error: `No students to upload. ${parsed.ignoredRows.map((row) => row.message).join(" ")} Add at least one student and upload again.`,
          ignored_rows: parsed.ignoredRows,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Upload has no student rows" }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        totals: countStudentAdditionTotals(parsed.rejectedResults),
        results: parsed.rejectedResults,
        ...(parsed.ignoredRows.length > 0 ? { ignored_rows: parsed.ignoredRows } : {}),
      },
      { status: 400 },
    );
  }

  const response = await proxyStudentAdditionRows({
    access,
    school,
    rows: parsed.rows,
    upload: {
      id: `student-bulk-${Date.now()}`,
      filename: uploadFilename(file),
    },
    period,
  });
  return NextResponse.json(
    mergeStudentAdditionResults({
      body: response.body,
      parsedRejectedResults: parsed.rejectedResults,
      originalRows: parsed.originalRows,
      ignoredRows: parsed.ignoredRows,
    }),
    { status: response.status },
  );
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
  if (!validation.ok) {
    return NextResponse.json(studentAdditionValidationBody(validation), { status: 400 });
  }
  const response = await proxyStudentAdditionRows({
    access,
    school,
    rows: [validation.row],
    upload: {
      id: `single-student-${Date.now()}`,
      filename: "one-by-one",
    },
    period,
  });
  return NextResponse.json(response.body, { status: response.status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const resolved = await resolveRouteContext(params);
  if (resolved.response) return resolved.response;

  const filename = STUDENT_ADDITION_TEMPLATE_FILENAMES[ACTIVE_REGISTRATION_MODE];
  const workbook = await readFile(studentAdditionTemplatePath());
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
