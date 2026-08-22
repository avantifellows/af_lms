import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getPhoneRegistrationStudentFacts,
  isPhoneRegistrationStudent,
  requireStudentAdditionStudentAccess,
  requireStudentEditAccess,
} from "@/lib/student-addition-access";
import {
  ACTIVE_REGISTRATION_MODE,
  APPROVED_REGISTRATION_MODE,
} from "@/lib/registration-mode";
import {
  hasPhoneCohortBackfillInput,
  hasPhoneCorrectionInput,
  prepareStudentEditFields,
  proxyStudentEdit,
} from "@/lib/student-edit-api";

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

    const phoneRegistrationFacts = await getPhoneRegistrationStudentFacts(id);
    const isPhoneStudent = isPhoneRegistrationStudent(phoneRegistrationFacts);
    const isPhoneCorrection = isPhoneStudent && hasPhoneCorrectionInput(bodyObject);
    const isApprovedPhoneBackfill =
      ACTIVE_REGISTRATION_MODE === APPROVED_REGISTRATION_MODE &&
      isPhoneStudent &&
      hasPhoneCohortBackfillInput(bodyObject);

    let writeAccess = access;
    if (isPhoneCorrection || isApprovedPhoneBackfill) {
      const correctionAccess = await requireStudentAdditionStudentAccess(session, id);
      if (!correctionAccess.ok) {
        return NextResponse.json(
          { error: correctionAccess.error },
          { status: correctionAccess.status },
        );
      }
      writeAccess = correctionAccess;
    }

    const preparation = prepareStudentEditFields({
      body: bodyObject,
      facts: phoneRegistrationFacts,
      isPhoneStudent,
      allowPhoneBackfill: isApprovedPhoneBackfill,
    });
    if (!preparation.ok) {
      return NextResponse.json(preparation.body, { status: preparation.status });
    }

    const response = await proxyStudentEdit({
      id,
      access: writeAccess,
      fields: preparation.fields,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
