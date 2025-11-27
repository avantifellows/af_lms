import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface StudentUpdatePayload {
  apaar_id: string;
  student_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  gender?: string;
  category?: string;
  stream?: string;
  status?: string;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: StudentUpdatePayload = await request.json();

    if (!body.apaar_id && !body.student_id) {
      return NextResponse.json(
        { error: "Either apaar_id or student_id is required for updating student" },
        { status: 400 }
      );
    }

    // Call DB service to update student
    const response = await fetch(`${DB_SERVICE_URL}/student`, {
      method: "POST",
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
