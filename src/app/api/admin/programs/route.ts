import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { listPrograms, requireCentreAdmin } from "@/lib/centres";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const search = new URL(request.url).searchParams.get("q") ?? undefined;
  const programs = await listPrograms({ search });

  return NextResponse.json({ programs });
}
