import { NextResponse } from "next/server";
import { failureResponse, withBlendedLearning } from "@/lib/blended-learning-guard";
import { recordJeeForm, type ConfirmationFile } from "@/lib/blended-learning-jee-form";

// Record a Mentee's JEE Main 2027 form status from the JEE Form tab:
// multipart `status` (filled | not_filled), `applicationNumber`, the
// exam-portal `password` (required while none is saved; blank keeps the saved
// one) and an optional `confirmation` PDF when filled, or one `reasons` entry
// per reason and optional `details` when not. Only the Mentor of an active
// Mapping records it; Blended Learning Admins and read-only accounts get 403
// (they may still reveal the password, through ./password). The
// password is stored only as KMS ciphertext, and the response carries only
// whether one is saved (`passwordSaved`), never the password.
export const POST = withBlendedLearning("record_jee_form", async (request, { access, id }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const confirmation = form.get("confirmation");
  // Duck-typed: `instanceof Blob` breaks across realms. An empty file input
  // sends a nameless, empty file, which means no confirmation.
  const file =
    confirmation && typeof confirmation !== "string" && typeof (confirmation as Blob).arrayBuffer === "function"
      ? (confirmation as unknown as ConfirmationFile)
      : null;

  const result = await recordJeeForm(
    access,
    id,
    {
      status: form.get("status"),
      applicationNumber: form.get("applicationNumber"),
      password: form.get("password"),
      reasons: form.getAll("reasons"),
      details: form.get("details"),
    },
    file && (file.size > 0 || file.name) ? file : null
  );
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ form: result.form }, { status: result.created ? 201 : 200 });
});
