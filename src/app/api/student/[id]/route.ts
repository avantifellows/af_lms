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
  type StudentEditProxyAccess,
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

type StrictPhoneAccessResult =
  | { ok: true; access: StudentEditProxyAccess }
  | { ok: false; status: 401 | 403; error: string };

function isPhoneStudentCorrection(
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>,
  body: Record<string, unknown>,
) {
  if (!isPhoneRegistrationStudent(facts)) return false;
  return hasPhoneCorrectionInput(body);
}

function shouldUseApprovedPhoneBackfill(
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>,
  body: Record<string, unknown>,
) {
  if (ACTIVE_REGISTRATION_MODE !== APPROVED_REGISTRATION_MODE) return false;
  if (!isPhoneRegistrationStudent(facts)) return false;
  return hasPhoneCohortBackfillInput(body);
}

async function resolveStrictPhoneWriteAccess({
  session,
  studentId,
  genericAccess,
  facts,
  body,
}: {
  session: Parameters<typeof requireStudentEditAccess>[0];
  studentId: string;
  genericAccess: StudentEditProxyAccess;
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>;
  body: Record<string, unknown>;
}): Promise<StrictPhoneAccessResult> {
  const isPhoneCorrection = isPhoneStudentCorrection(facts, body);
  const isApprovedPhoneBackfill = shouldUseApprovedPhoneBackfill(facts, body);
  if (!isPhoneCorrection && !isApprovedPhoneBackfill) {
    return { ok: true, access: genericAccess };
  }

  const strictAccess = await requireStudentAdditionStudentAccess(session, studentId);
  if (!strictAccess.ok) return strictAccess;
  return { ok: true, access: strictAccess };
}

type StudentEditStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

interface StudentEditAuthorisedRequest {
  body: Record<string, unknown>;
  access: StudentEditProxyAccess;
}

async function parseAndAuthoriseStudentEdit(
  request: NextRequest,
  id: string,
  session: Parameters<typeof requireStudentEditAccess>[0],
): Promise<StudentEditStageResult<StudentEditAuthorisedRequest>> {
  const parsedBody = await parseStudentEditBody(request);
  if (!parsedBody.ok) return { ok: false, response: parsedBody.response };

  const body = parsedBody.body;
  const access = await requireStudentEditAccess(session, id, parseStudentEditProgramId(body));
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: access.error }, { status: access.status }),
    };
  }
  return { ok: true, value: { body, access } };
}

interface StudentEditPhoneContext {
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>;
  writeAccess: StudentEditProxyAccess;
}

async function loadStudentEditPhoneContext({
  session,
  id,
  body,
  access,
}: {
  session: Parameters<typeof requireStudentEditAccess>[0];
  id: string;
  body: Record<string, unknown>;
  access: StudentEditProxyAccess;
}): Promise<StudentEditStageResult<StudentEditPhoneContext>> {
  const facts = await getPhoneRegistrationStudentFacts(id);
  const writeAccess = await resolveStrictPhoneWriteAccess({
    session,
    studentId: id,
    genericAccess: access,
    facts,
    body,
  });
  if (!writeAccess.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: writeAccess.error },
        { status: writeAccess.status },
      ),
    };
  }
  return { ok: true, value: { facts, writeAccess: writeAccess.access } };
}

function shouldAllowPhoneBackfill(
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>,
  body: Record<string, unknown>,
) {
  if (ACTIVE_REGISTRATION_MODE !== APPROVED_REGISTRATION_MODE) return false;
  if (!isPhoneRegistrationStudent(facts)) return false;
  return hasPhoneCohortBackfillInput(body);
}

function prepareStudentEditRequest({
  body,
  facts,
}: {
  body: Record<string, unknown>;
  facts: Awaited<ReturnType<typeof getPhoneRegistrationStudentFacts>>;
}): StudentEditStageResult<{ fields: Record<string, unknown> }> {
  const isPhoneStudent = isPhoneRegistrationStudent(facts);
  const preparation = prepareStudentEditFields({
    body,
    facts,
    isPhoneStudent,
    allowPhoneBackfill: shouldAllowPhoneBackfill(facts, body),
  });
  if (!preparation.ok) {
    return {
      ok: false,
      response: NextResponse.json(preparation.body, { status: preparation.status }),
    };
  }
  return { ok: true, value: { fields: preparation.fields } };
}

async function handleStudentEditPatch(
  request: NextRequest,
  id: string,
  session: Parameters<typeof requireStudentEditAccess>[0],
) {
  const authorised = await parseAndAuthoriseStudentEdit(request, id, session);
  if (!authorised.ok) return authorised.response;

  const phoneContext = await loadStudentEditPhoneContext({
    session,
    id,
    body: authorised.value.body,
    access: authorised.value.access,
  });
  if (!phoneContext.ok) return phoneContext.response;

  const preparation = prepareStudentEditRequest({
    body: authorised.value.body,
    facts: phoneContext.value.facts,
  });
  if (!preparation.ok) return preparation.response;

  const response = await proxyStudentEdit({
    id,
    access: phoneContext.value.writeAccess,
    fields: preparation.value.fields,
  });
  return NextResponse.json(response.body, { status: response.status });
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
    return await handleStudentEditPatch(request, id, session);
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
