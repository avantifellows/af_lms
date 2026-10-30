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
 * which survives as its per-test columns. Physical centres only — the filters
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
            <li><b>Test grade</b> filters the test columns (Latest AL, questions to next AL, score graph, per-test columns). Mode AL, Predicted and AL status are the student&apos;s overall values.</li>
            <li><b>Mode AL</b>: the most frequent level in the student&apos;s last 3 full tests (JEE Advanced papers excluded; a tie goes to the lower level). Retests count as tests.</li>
            <li><b>Stream</b>: a student sees only their own stream&apos;s tests (JEE or NEET); one with no stream recorded is read as engineering.</li>
            <li><b>Predicted</b>: from grade-10 Maths and Science marks; below 65 in either is M3. JEE Main only; JEE Advanced and NEET predictions will come later.</li>
            <li><b>AL status</b>: Mode better than Predicted is <i>Improving</i>, worse is <i>Sliding</i>, equal is <i>Same</i>.</li>
            <li><b>Latest AL</b>: the level on the student&apos;s newest full test that has one, retests skipped.</li>
            <li><b>Questions to next AL</b>: extra correct answers (+4 each) the marks on that latest test need to reach the cutoff of the level above the Latest AL, for the student&apos;s category. <i>Top</i> when already at M1 / B1.</li>
            <li><b>Score graph</b>: score % on every test, oldest to newest. Its colour is the direction over the last 5 tests: green <i>Improving</i>, red <i>Declining</i>, grey <i>Same</i> (less than a quarter of a point per test either way).</li>
            <li><b>Test columns</b>, newest first: marks (<i>AB</i> when absent) and the level on that test. The student&apos;s latest test shows ▲ / ▼ / ▬ and the change in marks since their previous test.</li>
            <li><b>Retests</b> carry the same name as the original test and are marked <i>Retest</i>. They are shown but not counted in Latest AL, the score graph or the change.</li>
            <li><b>Chapter flags</b> (4+ answers, score below the pass mark): <i>C · Concept gap</i> when accuracy is under 60%; <i>S · Skipping</i> when attempt is under 70% or nothing was attempted.</li>
            <li><b>Rank in centre</b>: among everyone at the School, grade and program who sat the test, including students who have since left.</li>
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
