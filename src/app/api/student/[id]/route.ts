import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { requireStudentEditAccess } from "@/lib/student-addition-access";
import { canonicalizeStudentEditPayload } from "@/lib/student-addition-fields";

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
    // Authorization runs before anything else that could leak state (DB-service
    // config, body-shape validation); the body must still be parsed first
    // because the program being edited under comes from it.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const bodyObject = body as Record<string, unknown>;

    // The client sends the program the student is being edited under (the
    // enrollment view's selected program). Access is authorized against that
    // program; db-service also verifies the student is currently enrolled in it.
    const rawProgramId = bodyObject.program_id;
    const programId =
      typeof rawProgramId === "number"
        ? rawProgramId
        : typeof rawProgramId === "string" && rawProgramId.trim() !== ""
          ? Number(rawProgramId)
          : null;

    const access = await requireStudentEditAccess(session, id, programId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const dbService = getDbServiceConfig();
    if (!dbService) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const canonical = canonicalizeStudentEditPayload(bodyObject);
    if (!canonical.ok) {
      return NextResponse.json(canonical, { status: 422 });
    }
    const { fields } = canonical;
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const response = await fetch(
      `${dbService.baseUrl}/lms/students/${id}/update-with-enrollments`,
      {
        method: "PATCH",
        headers: dbService.headers,
        body: JSON.stringify({
          actor: access.actor,
          school: access.school,
          program_id: access.programId,
          ...deriveLmsEnrollmentPeriod(),
          ...fields,
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
