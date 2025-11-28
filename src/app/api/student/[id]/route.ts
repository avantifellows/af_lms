import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface StudentUpdatePayload {
  first_name?: string;
  last_name?: string;
  phone?: string;
  gender?: string;
  category?: string;
  stream?: string;
  student_id?: string;
  apaar_id?: string;
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
    const body: StudentUpdatePayload = await request.json();

    // Call DB service to update student using PATCH
    const response = await fetch(`${DB_SERVICE_URL}/student/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DB service error:", errorText);
      return NextResponse.json(
        { error: "Failed to update student", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
