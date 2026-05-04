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

const RESOURCE_TYPE = "quiz_template";

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
  const gradeParam = searchParams.get("grade");
  const stream = (searchParams.get("stream") || "").trim();
  const testFormat = (searchParams.get("testFormat") || "").trim();
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
    console.error("Failed to fetch quiz templates:", errorText);
    return NextResponse.json(
      { error: "Failed to fetch quiz templates" },
      { status: response.status }
    );
  }

  const rawResources = (await response.json()) as RawQuizTemplateResource[];
  const grade = gradeParam ? Number(gradeParam) : null;

  const templates = rawResources
    .map(parseQuizTemplateResource)
    .filter((template) => template.type === RESOURCE_TYPE && template.isActive)
    .filter((template) => (grade === null ? true : template.grade === grade))
    .filter((template) => (stream ? template.stream === stream : true))
    .filter((template) => (testFormat ? template.testFormat === testFormat : true))
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
