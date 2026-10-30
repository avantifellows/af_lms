import type { CommonTarget } from "@/lib/blended-learning-manage-input";

// Who a Common Action Item goes to, in words (client-safe).
export function targetLabel(target: CommonTarget, mentorName: string | null): string {
  if (target.kind === "grade") return `Grade ${target.grade} students`;
  if (target.kind === "mentor") return mentorName ? `${mentorName}'s students` : "One mentor's students";
  if (target.kind === "students") {
    const count = target.studentIds.length;
    return `Specific students (${count} ${count === 1 ? "ID" : "IDs"} listed)`;
  }
  return "All students with a mentor";
}
