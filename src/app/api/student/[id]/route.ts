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

type ParsedStudentEditBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

async function parseStudentEditBody(request: NextRequest): Promise<ParsedStudentEditBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body must be an object" }, { status: 400 }),
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body must be an object" }, { status: 400 }),
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

function parseStudentEditProgramId(body: Record<string, unknown>) {
  const rawProgramId = body.program_id;
  if (typeof rawProgramId === "number") return rawProgramId;
  if (typeof rawProgramId === "string" && rawProgramId.trim() !== "") {
    return Number(rawProgramId);
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Student ID is required" },
      { status: 400 },
    );
  }

  try {
    const parsedBody = await parseStudentEditBody(request);
    if (!parsedBody.ok) return parsedBody.response;

    const body = parsedBody.body;
    const access = await requireStudentEditAccess(
      session,
      id,
      parseStudentEditProgramId(body),
    );
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const facts = await getPhoneRegistrationStudentFacts(id);
    const isPhoneStudent = isPhoneRegistrationStudent(facts);
    const allowPhoneBackfill =
      ACTIVE_REGISTRATION_MODE === APPROVED_REGISTRATION_MODE &&
      isPhoneStudent &&
      hasPhoneCohortBackfillInput(body);
    const requiresStrictNvsAccess =
      isPhoneStudent && (hasPhoneCorrectionInput(body) || allowPhoneBackfill);

    let writeAccess = access;
    if (requiresStrictNvsAccess) {
      const strictAccess = await requireStudentAdditionStudentAccess(session, id);
      if (!strictAccess.ok) {
        return NextResponse.json(
          { error: strictAccess.error },
          { status: strictAccess.status },
        );
      }
      writeAccess = strictAccess;
    }

    const preparation = prepareStudentEditFields({
      body,
      facts,
      isPhoneStudent,
      allowPhoneBackfill,
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
      { status: 500 },
    );
  }
}
