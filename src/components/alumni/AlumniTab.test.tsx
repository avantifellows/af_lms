import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AlumniTab from "./AlumniTab";

// The form is exercised through its API route tests; here it's a stub.
vi.mock("./AlumniForm", () => ({
  default: ({ userId }: { userId: string }) => <div data-testid="alumni-form">form for {userId}</div>,
}));

const fetchMock = vi.fn();

function respond(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AlumniTab", () => {
  it("loads the school's lists and starts on 'To add' when there are pass-outs", async () => {
    respond({
      pending: [{ userId: "1", afid: "A1", name: "Asha Rao", cohortYear: "2025-2026", program: "JNV CoE", gender: "", stream: "" }],
      alumni: [{ userId: "2", afid: "A2", name: "Ravi Kumar", cohortYear: "2019-2020", ugStatus: "Graduated", currentStatus: "", collegeUg: "" }],
    });
    render(<AlumniTab schoolCode="59525" />);

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/alumni/school/59525");
    expect(screen.getByRole("tab", { name: /To add · 1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Existing alumni · 1/ })).toBeInTheDocument();
  });

  it("opens the student passed in from search", async () => {
    respond({
      pending: [],
      alumni: [{ userId: "2", afid: "A2", name: "Ravi Kumar", cohortYear: "2019-2020", ugStatus: "", currentStatus: "", collegeUg: "" }],
    });
    render(<AlumniTab schoolCode="59525" initialStudentId="2" />);
    expect(await screen.findByTestId("alumni-form")).toHaveTextContent("form for 2");
  });

  it("shows the error when the lists can't load", async () => {
    respond({ error: "Access denied" }, false);
    render(<AlumniTab schoolCode="59525" />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
  });
});
