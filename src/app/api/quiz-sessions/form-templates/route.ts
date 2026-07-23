import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireQuizSessionAccess } from "@/lib/quiz-session-access";
import {
  parseQuizTemplateResource,
  type RawQuizTemplateResource,
} from "@/lib/quiz-template-resource";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

// Form (survey/questionnaire) templates are stored as their own resource type so
// they never mix into the quiz-paper picker. They reuse the quiz-template
// type_params shape (parseQuizTemplateResource already reads sheet_name + cms
// fields), differing by test_type=form / test_format=questionnaire.
const RESOURCE_TYPE = "form_template";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    return NextResponse.json(
      { error: "DB service is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("search") || "").trim().toLowerCase();

  const response = await fetch(
    `${DB_SERVICE_URL}/resource?type=${encodeURIComponent(RESOURCE_TYPE)}&limit=1000&sort_by=code&sort_order=asc`,
    {
      headers: {
        Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
        accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to fetch form templates:", errorText);
    return NextResponse.json(
      { error: "Failed to fetch form templates" },
      { status: response.status }
    );
  }

  const rawResources = (await response.json()) as RawQuizTemplateResource[];

  // No grade filter: some form templates (e.g. Student Profile) are grade-agnostic
  // — grade is sourced from the selected batch at session creation, not the template.
  const templates = rawResources
    .map(parseQuizTemplateResource)
    .filter((template) => template.type === RESOURCE_TYPE && template.isActive)
    .filter((template) =>
      search
        ? [template.name, template.code, template.testPurpose]
            .join(" ")
            .toLowerCase()
            .includes(search)
        : true
    );

  return NextResponse.json({ templates });
}
