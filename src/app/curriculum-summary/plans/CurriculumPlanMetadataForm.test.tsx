import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, mockRefresh } = vi.hoisted(() => ({ mockPush: vi.fn(), mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));

import CurriculumPlanMetadataForm from "./CurriculumPlanMetadataForm";

const VALUES = {
  title: "G11 2026-27",
  examTracks: ["neet" as const],
  academicYear: "2026-2027",
  grade: 11,
  closureDate: "2027-03-08",
};

function respond(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CurriculumPlanMetadataForm", () => {
  it("creates a plan with the entered details and opens its editor", async () => {
    const fetchMock = respond({ plan: { id: 42 } });
    render(<CurriculumPlanMetadataForm initialValues={{ ...VALUES, title: "" }} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "G12 2026-27" } });
    fireEvent.click(screen.getByLabelText("JEE Advanced"));
    fireEvent.click(screen.getByLabelText("JEE Main"));
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Academic year"), { target: { value: "2027-2028" } });
    fireEvent.change(screen.getByLabelText("Plan Closure Date"), { target: { value: "2027-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith("/curriculum-summary/plans/42"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/curriculum/plans");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    // Served tracks keep JEE Main, JEE Advanced, NEET order whatever order they're ticked in.
    expect(sentBody(fetchMock)).toEqual({
      title: "G12 2026-27",
      exam_tracks: ["jee_main", "jee_advanced", "neet"],
      academic_year: "2027-2028",
      grade: 12,
      closure_date: "2027-11-30",
    });
  });

  it("saves an existing plan's details, including an unticked track, and refreshes", async () => {
    const fetchMock = respond({ plan: { id: 7 } });
    render(<CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly={false} />);

    fireEvent.click(screen.getByLabelText("NEET"));
    fireEvent.click(screen.getByRole("button", { name: "Save plan details" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Plan details saved.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/curriculum/plans/7");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(sentBody(fetchMock).exam_tracks).toEqual([]);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("lists every validation error, naming the Chapter when there is one", async () => {
    respond(
      {
        error: "Invalid Curriculum Plan",
        errors: [
          { field: "title", message: "Title is required" },
          {
            field: "closure_date",
            chapterId: 9,
            chapterName: "Motion",
            message: "Chapter Due Date 2027-02-20 is after the Plan Closure Date 2026-12-31",
          },
        ],
      },
      false
    );
    render(<CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Save plan details" }));

    const errors = await screen.findByTestId("plan-details-errors");
    expect(errors).toHaveTextContent("Title is required");
    expect(errors).toHaveTextContent("Motion: Chapter Due Date 2027-02-20 is after the Plan Closure Date 2026-12-31");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: "Academic year and Grade are locked" }, "Academic year and Grade are locked"],
    [{}, "Could not save the plan"],
  ])("shows a form-level error (%j)", async (body, message) => {
    respond(body, false);
    render(<CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Save plan details" }));

    expect(await screen.findByTestId("plan-details-errors")).toHaveTextContent(message);
  });

  it("shows an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Save plan details" }));

    expect(await screen.findByTestId("plan-details-errors")).toHaveTextContent("Could not save the plan");
  });

  it.each([
    [1, "1 Centre is"],
    [2, "2 Centres are"],
  ])("locks academic year and Grade while %s Centre(s) are assigned", (assignmentCount, text) => {
    render(
      <CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly={false} assignmentCount={assignmentCount} />
    );

    expect(screen.getByLabelText("Academic year")).toBeDisabled();
    expect(screen.getByLabelText("Grade")).toBeDisabled();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByTestId("plan-assignment-lock")).toHaveTextContent(text);
  });

  it("is read-only for a read-only Admin", () => {
    render(<CurriculumPlanMetadataForm planId={7} initialValues={VALUES} readOnly />);

    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("NEET")).toBeDisabled();
    expect(screen.getByLabelText("Plan Closure Date")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save plan details" })).toBeDisabled();
    expect(screen.queryByTestId("plan-assignment-lock")).not.toBeInTheDocument();
  });
});
