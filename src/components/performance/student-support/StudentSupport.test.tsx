import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentSupport from "./StudentSupport";

vi.mock("./ScoreJourney", () => ({ default: () => <p>Score journey table</p> }));
vi.mock("./StudentReport", () => ({ default: () => <p>Student report</p> }));

describe("StudentSupport", () => {
  it("explains the stream default and who the rank is among", async () => {
    render(<StudentSupport schoolUdise="70705" grade={12} program="JNV CoE" />);
    expect(screen.getByText("Score journey table")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "How these numbers are worked out" }));
    expect(screen.getByText(/one with no stream recorded is read as engineering/)).toBeInTheDocument();
    expect(screen.getByText(/including students who have since left/)).toBeInTheDocument();
  });
});
