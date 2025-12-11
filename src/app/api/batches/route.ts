import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const programId = searchParams.get("program_id");

  if (!programId) {
    return NextResponse.json(
      { error: "program_id is required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `${DB_SERVICE_URL}/batch?program_id=${programId}`,
      {
        headers: {
          Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DB service error:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch batches" },
        { status: response.status }
      );
    }

    const batches = await response.json();
    return NextResponse.json(batches);
  } catch (error) {
    console.error("Error fetching batches:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
