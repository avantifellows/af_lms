import { NextResponse } from "next/server";
import { requireQuizSessionRequestAccess } from "@/lib/quiz-session-access";

function getCmsServiceConfig() {
  const url = process.env.CMS_SERVICE_URL?.trim();
  const token = process.env.CMS_SERVICE_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export async function requireCmsServiceAccess() {
  const access = await requireQuizSessionRequestAccess("view");
  if (!access.ok) return access;

  const cms = getCmsServiceConfig();
  if (!cms) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "CMS service is not configured" },
        { status: 500 }
      ),
    };
  }

  return { ...access, cms };
}
