import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface BatchMetadata {
  stream?: string;
  grade?: number;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Batch ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { metadata }: { metadata: BatchMetadata } = body;

    if (!metadata) {
      return NextResponse.json(
        { error: "metadata is required" },
        { status: 400 }
      );
    }

    // Validate metadata fields
    const validStreams = ["engineering", "medical", "ca", "clat", "pcmb", "pcb", "pcm", "foundation"];
    const validGrades = [9, 10, 11, 12];

    if (metadata.stream && !validStreams.includes(metadata.stream)) {
      return NextResponse.json(
        { error: `Invalid stream. Must be one of: ${validStreams.join(", ")}` },
        { status: 400 }
      );
    }

    if (metadata.grade && !validGrades.includes(metadata.grade)) {
      return NextResponse.json(
        { error: `Invalid grade. Must be one of: ${validGrades.join(", ")}` },
        { status: 400 }
      );
    }

    const response = await fetch(`${DB_SERVICE_URL}/batch/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ metadata }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DB service error:", errorText);
      return NextResponse.json(
        { error: "Failed to update batch" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating batch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
