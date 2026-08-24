const REQUIRED_SCOPE_ERROR =
  "school_code, program_id, exam_track, grade, and subject are required";

export function parseCurriculumRouteScope(input: Record<string, unknown>) {
  const schoolCode = typeof input.school_code === "string" ? input.school_code.trim() : "";
  const programId =
    typeof input.program_id === "string" || typeof input.program_id === "number"
      ? Number(input.program_id)
      : Number.NaN;
  const examTrack = typeof input.exam_track === "string" ? input.exam_track.trim() : "";
  const grade =
    typeof input.grade === "string" || typeof input.grade === "number"
      ? Number(input.grade)
      : Number.NaN;
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";

  if (
    !schoolCode ||
    !Number.isFinite(programId) ||
    !examTrack ||
    !Number.isFinite(grade) ||
    !subject
  ) {
    return { ok: false as const, error: REQUIRED_SCOPE_ERROR };
  }

  return {
    ok: true as const,
    value: { schoolCode, programId, examTrack, grade, subject },
  };
}
