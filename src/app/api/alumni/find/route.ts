import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { findAlumni } from "@/lib/alumni/students";

/** Find existing alumni by AFID or name, within the person's alumni scope: ?q= */
export async function GET(request: Request) {
  const auth = await authorizeAlumni();
  if (!auth.ok) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
  try {
    return NextResponse.json({ results: await findAlumni(auth.permission, q) });
  } catch (error) {
    console.error("[alumni/find]", error);
    return NextResponse.json({ error: "Couldn't search alumni." }, { status: 500 });
  }
}
