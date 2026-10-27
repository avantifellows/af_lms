import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { searchBranches, searchColleges } from "@/lib/alumni/reference";

/** College / branch search for the alumni form: ?q=nit surathkal */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await authorizeAlumni();
  if (!auth.ok) return auth.response;
  const { kind } = await params;
  if (kind !== "college" && kind !== "branch") {
    return NextResponse.json({ error: "Unknown search." }, { status: 404 });
  }
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
  try {
    const results = kind === "college" ? await searchColleges(q) : await searchBranches(q);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[alumni/search]", error);
    return NextResponse.json({ error: "Search failed. Try again." }, { status: 500 });
  }
}
