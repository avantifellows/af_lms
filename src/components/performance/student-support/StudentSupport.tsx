"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import ScoreJourney from "./ScoreJourney";
import StudentReport from "./StudentReport";

interface Props {
  schoolUdise: string;
  grade: number;
  program: string;
  stream?: string;
  testGrade?: number;
}

/**
 * The cumulative report (Teacher View v2, #324): the Score journey for the grade,
 * and a student's report one click away. It replaced the per-test AL matrix,
 * which survives as its "All tests" columns. Physical centres only — the filters
 * never offer Cumulative to JNV NVS, and the API refuses NVS too.
 */
export default function StudentSupport({ schoolUdise, grade, program, stream, testGrade }: Props) {
  const [student, setStudent] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const scope = { schoolUdise, grade, program };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">
          {student ? "Student report" : "Score journey"}
        </h3>
        <button
          type="button"
          onClick={() => setHelp(true)}
          aria-label="How these numbers are worked out"
          className="h-7 w-7 rounded-full border border-border text-sm font-bold text-text-muted hover:text-text-primary"
        >
          ?
        </button>
      </div>

      {student ? (
        // Keyed so a new student starts with a fresh report state.
        <StudentReport key={student} {...scope} uid={student} onBack={() => setStudent(null)} />
      ) : (
        <ScoreJourney {...scope} stream={stream} testGrade={testGrade} onOpenStudent={setStudent} />
      )}

      <Modal open={help} onClose={() => setHelp(false)}>
        <div className="max-w-lg space-y-3 rounded-xl bg-bg-card p-5 text-sm">
          <h4 className="text-base font-bold">How these are worked out</h4>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>Test grade</b> filters the test columns (last 3 tests, latest score, questions to next AL, all tests). Mode AL, Predicted and AL status are the student&apos;s overall values.</li>
            <li><b>Mode AL</b>: the most frequent level in the student&apos;s last 3 full tests (JEE Advanced papers excluded; a tie goes to the lower level). Retests count as tests.</li>
            <li><b>Predicted</b>: from grade-10 Maths and Science marks (65+ in both). JEE Main only; JEE Advanced and NEET predictions will come later.</li>
            <li><b>AL status</b>: Mode better than Predicted is <i>Improving</i>, worse is <i>Sliding</i>, equal is <i>Same</i>.</li>
            <li><b>Questions to next mode AL</b>: extra correct answers (+4 each) the median of the last 3 levelled tests needs to reach the next level&apos;s cutoff.</li>
            <li><b>Chapter flags</b> (4+ answers, score below the pass mark): <i>C · Concept gap</i> when accuracy is under 60%; <i>S · Skipping</i> when attempt is under 70% or nothing was attempted.</li>
            <li><b>Pass marks</b> (score %): JEE Main 35, JEE Advanced 30, NEET Physics/Chemistry 50, Biology 75.</li>
          </ul>
          <div className="text-right">
            <button type="button" onClick={() => setHelp(false)} className="rounded border border-border px-3 py-1 text-sm">
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
