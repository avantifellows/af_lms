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

// The "?" help, one term and its explanation per line.
const HELP: [string, React.ReactNode][] = [
  ["Test grade", <>filters the test columns (Latest AL, questions to next AL, score graph, per-test columns). Mode AL, Predicted and AL status are the student&apos;s overall values.</>],
  ["Mode AL", <>the most frequent level in the student&apos;s last 3 full tests (JEE Advanced papers excluded; a tie goes to the lower level). Retests count as tests.</>],
  ["Stream", <>a student sees only their own stream&apos;s tests (JEE or NEET); one with no stream recorded is read as engineering.</>],
  [
    "Predicted",
    <>
      from grade-10 Maths and Science marks; below 65 in either is M3. It is for JEE Main only, so it is blank for every
      medical (NEET) student. It is also blank wherever grade-10 marks are missing, which today includes every
      engineering student in several physical-centre programs. With no Predicted, AL status is blank too.
    </>,
  ],
  ["AL status", <>Mode better than Predicted is <i>Improving</i>, worse is <i>Sliding</i>, equal is <i>Same</i>.</>],
  ["Latest AL", <>the level on the student&apos;s newest full test that has one, retests skipped.</>],
  [
    "Questions to next AL",
    <>extra correct answers (+4 each) the marks on that latest test need to reach the cutoff of the level above the Latest AL, for the student&apos;s category. <i>Top</i> when already at M1 / B1.</>,
  ],
  [
    "Score graph",
    <>score % on every levelled test (JEE Main or NEET), oldest to newest, retests skipped. Its colour is the direction over the last 5 tests: green <i>Improving</i>, red <i>Declining</i>, grey <i>Same</i> (less than a quarter of a point per test either way).</>,
  ],
  [
    "Test columns",
    <>newest first, marks (<i>AB</i> when absent) and the level on that test. The student&apos;s latest test shows ▲ / ▼ / ▬ and the change in score % (percentage points) since their previous test of the same exam, skipping retests and tests with no level.</>,
  ],
  [
    "Which tests are listed",
    <>tests dated this academic year (from 1 April) that at least 20% of the students who sat that stream&apos;s tests sat; a student&apos;s report also lists every test they sat themselves.</>,
  ],
  [
    "Retests",
    <>a test the student sits again under the same name. Their second sitting is marked <i>R</i> (a column is marked <i>Retest</i> when every sitting in it is one). Retests are shown but not counted in Latest AL, the score graph or the change.</>,
  ],
  ["Chapter flags", <>only for 4+ answers scoring below the pass mark: <i>C · Concept gap</i> when accuracy is under 60%; <i>S · Skipping</i> when attempt is under 70% or nothing was attempted.</>],
  ["Rank in centre", <>among everyone at the School, grade and program who sat the test, including students who have since left.</>],
  ["Pass marks", <>score %: JEE Main 35, JEE Advanced 30, NEET Physics/Chemistry 50, Biology 75.</>],
];

/**
 * The cumulative report (Teacher View v2, #324): the Score journey for the grade,
 * and a student's report one click away. It replaced the per-test AL matrix,
 * which survives as its per-test columns. Physical centres only — the filters
 * never offer Cumulative to JNV NVS, and the API refuses NVS too.
 */
function StudentSupportView({ schoolUdise, grade, program, stream, testGrade }: Props) {
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
            {HELP.map(([term, text]) => (
              <li key={term}>
                <b>{term}</b>: {text}
              </li>
            ))}
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

/** Keyed by grade and program: a student open in one grade isn't in the
 *  next, so a change goes back to the Score journey. */
export default function StudentSupport(props: Props) {
  return <StudentSupportView key={`${props.grade}|${props.program}`} {...props} />;
}
