"use client";

// Shared Student identity columns and phone-card ID line for the Test Attendance
// Month and All year pages (#517). Client-safe.
import type { TestAttendanceStudent } from "@/types/test-attendance";

/** A Student ID or APAAR ID cell value: "—" when missing (matches the Students tab). */
const idText = (value: string | null) => value || "—";

/** Leading Student identity headers shared by the Month and All year tables. */
export function StudentIdentityHeaders() {
  return (
    <>
      <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student</th>
      <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student ID</th>
      <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">APAAR ID</th>
      <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Grade</th>
      <th scope="col" className="py-2 pr-3 font-medium">Exam Preparing For</th>
    </>
  );
}

/** Leading Student identity cells matching {@link StudentIdentityHeaders}. */
export function StudentIdentityCells({
  student,
}: {
  student: Pick<TestAttendanceStudent, "name" | "studentId" | "apaarId" | "grade" | "examPreparingFor">;
}) {
  return (
    <>
      <td className="min-w-32 py-2 pr-3 text-text-primary">{student.name}</td>
      <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
        {idText(student.studentId)}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
        {idText(student.apaarId)}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{student.grade}</td>
      <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{student.examPreparingFor ?? "Not set"}</td>
    </>
  );
}

/** Secondary ID line under a Student's name on phone cards; wraps between the two IDs, never mid-value. */
export function StudentIdsLine({ student }: { student: Pick<TestAttendanceStudent, "studentId" | "apaarId"> }) {
  return (
    <p className="text-xs text-text-muted">
      <span className="whitespace-nowrap">
        Student ID <span className="font-mono">{idText(student.studentId)}</span>
      </span>{" "}
      ·{" "}
      <span className="whitespace-nowrap">
        APAAR ID <span className="font-mono">{idText(student.apaarId)}</span>
      </span>
    </p>
  );
}
