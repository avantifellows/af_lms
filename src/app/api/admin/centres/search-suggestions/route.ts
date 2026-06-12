import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getCentreSearchSuggestions,
  requireCentreAdmin,
  safeCentreApiError,
} from "@/lib/centres";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = new URL(request.url).searchParams;
  const result = await getCentreSearchSuggestions({
    search: searchParams.get("q") ?? "",
    limit: Number.parseInt(searchParams.get("limit") ?? "8", 10),
  });

  if (!result.ok) {
    return NextResponse.json(safeCentreApiError(result), { status: result.status });
  }

  return NextResponse.json({ suggestions: result.suggestions });
}
