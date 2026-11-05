import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentSupport from "./StudentSupport";

vi.mock("./ScoreJourney", () => ({
  default: ({ onOpenStudent }: { onOpenStudent: (uid: string) => void }) => (
    <div>
      <p>Score journey table</p>
      <button type="button" onClick={() => onOpenStudent("7")}>Open student</button>
    </div>
  ),
}));
vi.mock("./StudentReport", () => ({ default: ({ uid }: { uid: string }) => <p>Report for {uid}</p> }));

async function openHelp() {
  render(<StudentSupport schoolUdise="70705" grade={12} program="JNV CoE" />);
  expect(screen.getByText("Score journey table")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "How these numbers are worked out" }));
}

/** Renders the Score journey and opens student 7's report. */
async function openReport() {
  const view = render(<StudentSupport schoolUdise="70705" grade={12} program="JNV CoE" />);
  await userEvent.click(screen.getByRole("button", { name: "Open student" }));
  expect(screen.getByText("Report for 7")).toBeInTheDocument();
  return view.rerender;
}

describe("StudentSupport help", () => {
  it.each([
    ["the stream default", /one with no stream recorded is read as engineering/],
    ["who the rank is among", /including students who have since left/],
    ["Latest AL", /newest full test that has one, retests skipped/],
    ["questions to next AL", /the marks on that latest test need to reach the cutoff/],
    ["the score graph", /direction over the last 5 tests/],
    ["retests", /a test the student sits again under the same name/],
    ["Predicted for medical students", /blank for every\s+medical \(NEET\) student/],
    ["Predicted where grade-10 marks are missing", /every\s+engineering student in several physical-centre programs/],
    ["the change in score %", /change in score % \(percentage points\) since their previous test of the same exam/],
    ["which tests are listed", /at least 20% of the students/],
  ])("explains %s", async (_, text) => {
    await openHelp();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("drops the old rules", async () => {
    await openHelp();
    expect(screen.queryByText(/median of the last 3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/predictions will come later/)).not.toBeInTheDocument();
  });
});

describe("StudentSupport report", () => {
  it("goes back to the Score journey when the grade or program changes with a report open", async () => {
    const rerender = await openReport();
    rerender(<StudentSupport schoolUdise="70705" grade={11} program="JNV CoE" />);
    expect(screen.queryByText(/Report for/)).not.toBeInTheDocument();
    expect(screen.getByText("Score journey table")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open student" }));
    rerender(<StudentSupport schoolUdise="70705" grade={11} program="Punjab CoE" />);
    expect(screen.getByText("Score journey table")).toBeInTheDocument();
  });

  it("keeps the report open when only the stream or test grade changes", async () => {
    const rerender = await openReport();
    rerender(<StudentSupport schoolUdise="70705" grade={12} program="JNV CoE" stream="medical" testGrade={11} />);
    expect(screen.getByText("Report for 7")).toBeInTheDocument();
  });
});
