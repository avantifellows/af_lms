import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface DropoutPayload {
  student_id?: string;
  apaar_id?: string;
  start_date: string;
  academic_year: string;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: DropoutPayload = await request.json();

    if (!body.student_id && !body.apaar_id) {
      return NextResponse.json(
        { error: "Either student_id or apaar_id is required" },
        { status: 400 },
      );
    }

    if (!body.start_date) {
      return NextResponse.json(
        { error: "start_date is required" },
        { status: 400 },
      );
    }

    if (!body.academic_year) {
      return NextResponse.json(
        { error: "academic_year is required" },
        { status: 400 },
      );
    }

    // Build query parameters - DB service accepts either student_id or apaar_id
    const queryParams = new URLSearchParams({
      start_date: body.start_date,
      academic_year: body.academic_year,
    });

    if (body.student_id) {
      queryParams.set("student_id", body.student_id);
    } else if (body.apaar_id) {
      queryParams.set("apaar_id", body.apaar_id);
    }

    // Call DB service to mark student as dropout using query parameters
    const response = await fetch(
      `${DB_SERVICE_URL}/dropout?${queryParams.toString()}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
        },
      },
    );

    if (response.status === 200) {
      return NextResponse.json({ success: true });
    }

    if (response.status === 400) {
      const errorData = await response.json();
      if (errorData.errors === "Student is already marked as dropout") {
        return NextResponse.json(
          { error: "Student is already marked as dropout" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: errorData.errors || "Failed to mark student as dropout" },
        { status: 400 },
      );
    }

    const errorText = await response.text();
    console.error("DB service error:", errorText);
    return NextResponse.json(
      { error: "Failed to mark student as dropout", details: errorText },
      { status: response.status },
    );
  } catch (error) {
    console.error("Error marking student as dropout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
