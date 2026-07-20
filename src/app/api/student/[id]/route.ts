import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";
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
    const access = await requireStudentAdditionStudentAccess(session, id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const dbService = getDbServiceConfig();
    if (!dbService) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const canonical = canonicalizeStudentEditPayload(body as Record<string, unknown>);
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
