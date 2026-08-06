import { formatExamTrack, type ExamTrack } from "./exam-tracks";

export function getSubjectExamTrackCompatibilityError(
  subject: string,
  examTrack: ExamTrack
): string | null {
  const invalid =
    (subject === "Biology" &&
      (examTrack === "jee_main" || examTrack === "jee_advanced")) ||
    (subject === "Maths" && examTrack === "neet");

  return invalid ? `${subject} is not valid with ${formatExamTrack(examTrack)}` : null;
}
