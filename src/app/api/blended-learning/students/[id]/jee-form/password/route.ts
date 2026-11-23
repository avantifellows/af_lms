import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { revealJeeFormPassword } from "@/lib/blended-learning-jee-password";

// Reveal the Mentee's JEE Main 2027 exam-portal password, logged per reveal
// (blended-learning-jee-password). POST, not GET: it writes the log, and it
// must never be cached or prefetched. 401 signed out, 403 without Blended
// Learning access, for a read-only account (Mentor or admin), or out of scope
// (another Mentor's Mentee, no active Mapping), 404 with no password saved,
// 500 when KMS or the log fails. A refused reveal decrypts and logs nothing.

const NO_STORE = { "Cache-Control": "no-store" };

export const POST = withBlendedLearning("reveal_exam_password", async (_request, { access, id }) => {
  try {
    const result = await revealJeeFormPassword(access, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return NextResponse.json({ password: result.password }, { headers: NO_STORE });
  } catch (error) {
    // Never log the password or the ciphertext: the error's name is enough.
    console.error("JEE form password reveal failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
});
