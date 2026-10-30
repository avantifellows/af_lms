import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentSupport from "./StudentSupport";

vi.mock("./ScoreJourney", () => ({ default: () => <p>Score journey table</p> }));
vi.mock("./StudentReport", () => ({ default: () => <p>Student report</p> }));

async function openHelp() {
  render(<StudentSupport schoolUdise="70705" grade={12} program="JNV CoE" />);
  expect(screen.getByText("Score journey table")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "How these numbers are worked out" }));
}

describe("StudentSupport", () => {
  it("explains the stream default and who the rank is among", async () => {
    await openHelp();
    expect(screen.getByText(/one with no stream recorded is read as engineering/)).toBeInTheDocument();
    expect(screen.getByText(/including students who have since left/)).toBeInTheDocument();
  });

  it("explains Latest AL, questions to next AL, the score graph and retests", async () => {
    await openHelp();
    expect(screen.getByText(/newest full test that has one, retests skipped/)).toBeInTheDocument();
    expect(screen.getByText(/the marks on that latest test need to reach the cutoff/)).toBeInTheDocument();
    expect(screen.getByText(/direction over the last 5 tests/)).toBeInTheDocument();
    expect(screen.getByText(/carry the same name as the original test/)).toBeInTheDocument();
    expect(screen.queryByText(/median of the last 3/)).not.toBeInTheDocument();
  });
});
