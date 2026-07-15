import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";
import { STUDENT_DOB_MAX, STUDENT_DOB_MIN } from "@/lib/student-addition-fields";

interface StudentUpdatePayload {
  // user-table fields
  first_name?: string;
  last_name?: string;
  phone?: string;
  gender?: string;
  date_of_birth?: string;
  // student-table fields
  category?: string;
  physically_handicapped?: boolean;
  stream?: string;
  board_stream?: string;
  father_name?: string;
  annual_family_income?: string;
  g10_board?: string | null;
  grade?: number;
}

const EDITABLE_FIELDS: ReadonlyArray<keyof StudentUpdatePayload> = [
  "first_name",
  "last_name",
  "phone",
  "gender",
  "date_of_birth",
  "category",
  "physically_handicapped",
  "stream",
  "board_stream",
  "father_name",
  "annual_family_income",
  "g10_board",
  "grade",
];

function editablePayload(body: Record<string, unknown>): StudentUpdatePayload {
  return EDITABLE_FIELDS.reduce<StudentUpdatePayload>((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return { ...payload, [field]: body[field] };
    }
    return payload;
  }, {});
}

function canonicalEditablePayload(fields: StudentUpdatePayload): StudentUpdatePayload {
  return {
    ...fields,
    ...(fields.gender === "Others" ? { gender: "Other" } : {}),
    ...(fields.g10_board === "Others" ? { g10_board: null } : {}),
    ...(fields.physically_handicapped === true && fields.category
      ? { category: fields.category === "Gen-EWS" ? "PWD-EWS" : `PWD-${fields.category}` }
      : {}),
  };
}

function validateEditablePayload(fields: StudentUpdatePayload) {
  if (fields.first_name !== undefined && typeof fields.first_name !== "string") {
    return { error: "Student Name must be text", field_errors: { first_name: "Student Name must be text" } };
  }
  if (
    fields.gender !== undefined &&
    !["Female", "Male", "Other", "Others"].includes(fields.gender)
  ) {
    return { error: "Gender must be Female, Male, or Other", field_errors: { gender: "Gender must be Female, Male, or Other" } };
  }
  if (fields.g10_board !== undefined && !["CBSE", "Others"].includes(fields.g10_board ?? "")) {
    return { error: "G10 board must be CBSE or Others", field_errors: { g10_board: "G10 board must be CBSE or Others" } };
  }
  if (
    fields.stream !== undefined &&
    !["engineering", "medical", "ca", "clat", "nda"].includes(fields.stream)
  ) {
    return { error: "Primary Exam preparing for is not valid", field_errors: { stream: "Primary Exam preparing for is not valid" } };
  }
  if (
    fields.board_stream !== undefined &&
    !["PCM", "PCB", "PCMB", "Commerce (Math)", "Commerce (Without Math)", "Arts/Humanities"].includes(fields.board_stream)
  ) {
    return { error: "Board Stream is not valid", field_errors: { board_stream: "Board Stream is not valid" } };
  }
  if (
    fields.category !== undefined &&
    !["Gen", "Gen-EWS", "OBC", "SC", "ST"].includes(fields.category)
  ) {
    return { error: "Category is not valid", field_errors: { category: "Category is not valid" } };
  }
  if (
    fields.physically_handicapped !== undefined &&
    typeof fields.physically_handicapped !== "boolean"
  ) {
    return { error: "CWSN must be true or false", field_errors: { physically_handicapped: "CWSN must be true or false" } };
  }
  if (fields.phone !== undefined && (typeof fields.phone !== "string" || !/^\d{10}$/.test(fields.phone))) {
    return { error: "Parents Phone Number must be exactly 10 digits", field_errors: { phone: "Parents Phone Number must be exactly 10 digits" } };
  }
  if (fields.date_of_birth !== undefined) {
    const date = new Date(`${fields.date_of_birth}T00:00:00Z`);
    if (
      typeof fields.date_of_birth !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fields.date_of_birth) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== fields.date_of_birth
    ) {
      return { error: "Date of Birth is not valid", field_errors: { date_of_birth: "Date of Birth is not valid" } };
    }
  }
  if (
    fields.date_of_birth !== undefined &&
    (fields.date_of_birth < STUDENT_DOB_MIN || fields.date_of_birth > STUDENT_DOB_MAX)
  ) {
    return { error: "Date of Birth must be between 2000 and 2015", field_errors: { date_of_birth: "Date of Birth must be between 2000 and 2015" } };
  }
  if (fields.grade !== undefined && ![11, 12].includes(fields.grade)) {
    return { error: "Grade must be 11 or 12", field_errors: { grade: "Grade must be 11 or 12" } };
  }
  return null;
}

// fallow-ignore-next-line complexity
async function dbServiceError(response: Response) {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const error =
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object"
      ? parsed.error as { code?: string; message?: string; fields?: string[] }
      : null;
  const message =
    error?.message || "Failed to update student";
  const fields = Array.isArray(error?.fields) ? error.fields : [];

  return NextResponse.json(
    {
      error: message,
      code: error?.code,
      field_errors: Object.fromEntries(fields.map((field) => [field, message])),
    },
    { status: response.status },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Student ID is required" },
      { status: 400 }
    );
  }

  try {
    const access = await requireStudentAdditionStudentAccess(session, id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const dbServiceUrl = process.env.DB_SERVICE_URL?.replace(/\/+$/, "");
    const dbServiceToken = process.env.DB_SERVICE_TOKEN;
    if (!dbServiceUrl || !dbServiceToken) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const fields = editablePayload(body as Record<string, unknown>);
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }
    const validationError = validateEditablePayload(fields);
    if (validationError) {
      return NextResponse.json(validationError, { status: 422 });
    }

    const response = await fetch(
      `${dbServiceUrl}/lms/students/${id}/update-with-enrollments`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${dbServiceToken}`,
        },
        body: JSON.stringify({
          actor: access.actor,
          school: access.school,
          program_id: access.programId,
          ...deriveLmsEnrollmentPeriod(),
          ...canonicalEditablePayload(fields),
        }),
      },
    );

    if (!response.ok) {
      return dbServiceError(response);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
