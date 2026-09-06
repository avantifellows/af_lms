import { formatExamTrack, type ExamTrack } from "./exam-tracks";

export const BIOLOGY_INCOMPATIBLE_EXAM_TRACKS = [
  "jee_main",
  "jee_advanced",
] as const satisfies readonly ExamTrack[];
export const MATHS_INCOMPATIBLE_EXAM_TRACKS = [
  "neet",
] as const satisfies readonly ExamTrack[];

export function getSubjectExamTrackCompatibilityError(
  subject: string,
  examTrack: ExamTrack
): string | null {
  const invalid =
    (subject === "Biology" &&
      BIOLOGY_INCOMPATIBLE_EXAM_TRACKS.some((track) => track === examTrack)) ||
    (subject === "Maths" &&
      MATHS_INCOMPATIBLE_EXAM_TRACKS.some((track) => track === examTrack));

  return invalid ? `${subject} is not valid with ${formatExamTrack(examTrack)}` : null;
}
