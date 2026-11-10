import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import type { JeeFormUpdate, JeeFormView } from "@/lib/blended-learning-jee-form-input";

import { JeeFormCard } from "./JeeFormCard";

const REMINDER_OPEN = { id: 81, text: "JEE Form Filling (Reminder)", status: "open" as const };
const EMPTY: JeeFormView = { current: null, earlier: [], reminderItems: [REMINDER_OPEN] };
const FILLED: JeeFormUpdate = {
  id: 3,
  status: "filled",
  applicationNumber: "270310000001",
  hasConfirmation: true,
  reasons: [],
  details: null,
  recordedOn: "2026-11-10",
  flagRaised: false,
};
const NOT_FILLED: JeeFormUpdate = {
  id: 2,
  status: "not_filled",
  applicationNumber: null,
  hasConfirmation: false,
  reasons: ["certificate_not_available", "other"],
  details: "Waiting for the income certificate",
  recordedOn: "2026-11-03",
  flagRaised: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

function sentForm(): FormData {
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/blended-learning/students/501/jee-form");
  expect(init.method).toBe("POST");
  return init.body as FormData;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ form: EMPTY }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JeeFormCard before anything is recorded", () => {
  it("shows a read-only viewer 'Not recorded yet' with no controls", () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord={false} />);

    const card = screen.getByRole("region", { name: "JEE Main 2027 form" });
    expect(within(card).getAllByText(/Not recorded yet/)).toHaveLength(2);
    expect(within(card).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks a recorder whether the form is filled, with no password field anywhere", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);

    expect(screen.getByText("Not recorded yet")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Has the student filled the form?" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual([
      "Filled",
      "Not filled",
    ]);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    expect(screen.getByLabelText("Application number")).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirmation page/)).toHaveAttribute("accept", "application/pdf,.pdf");
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });

  it("can't be shown when its data didn't load", () => {
    render(<JeeFormCard studentId={501} form={null} canRecord />);
    expect(screen.getByText("The JEE form can't be shown right now.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

describe("JeeFormCard recording Filled", () => {
  it("needs an application number before posting", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter the application number.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the number and the PDF, says it ticks the reminder, and refreshes the page", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    expect(screen.getByText(/Saving ticks the student's “JEE Form Filling \(Reminder\)” action item/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Application number"), "270310000001");
    const pdf = new File(["%PDF-"], "confirmation.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Confirmation page/), pdf);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const body = sentForm();
    expect([...body.keys()].sort()).toEqual(["applicationNumber", "confirmation", "status"]);
    expect(body.get("status")).toBe("filled");
    expect(body.get("applicationNumber")).toBe("270310000001");
    expect((body.get("confirmation") as File).name).toBe("confirmation.pdf");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("refuses a confirmation that isn't a PDF in the browser", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.type(screen.getByLabelText("Application number"), "2703");
    await userEvent.upload(screen.getByLabelText(/Confirmation page/), new File(["x"], "photo.png", { type: "image/png" }), {
      applyAccept: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Choose a PDF file.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's field error, such as a number held by another record, and keeps the form", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "This application number is already saved for JEE Advanced.",
          fieldErrors: { applicationNumber: "This application number is already saved for JEE Advanced." },
        }),
        { status: 409 }
      )
    );
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.type(screen.getByLabelText("Application number"), "2703");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This application number is already saved for JEE Advanced.")).toBeInTheDocument();
    expect(screen.getByLabelText("Application number")).toHaveValue("2703");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("JeeFormCard recording Not filled", () => {
  it("offers the eleven reasons and needs at least one", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Not filled" }));

    const reasons = screen.getByRole("group", { name: "Why hasn't it been filled?" });
    expect(within(reasons).getAllByRole("checkbox")).toHaveLength(11);
    expect(within(reasons).getByRole("checkbox", { name: "Will fill the form after parent's get the salary" })).toBeInTheDocument();
    expect(screen.getByText("Saving flags this to the program team.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Choose at least one reason.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes details required once Other is ticked, then posts every reason and the details", async () => {
    render(<JeeFormCard studentId={501} form={EMPTY} canRecord />);
    await userEvent.click(screen.getByRole("radio", { name: "Not filled" }));
    expect(screen.getByLabelText(/Details/)).not.toBeRequired();

    await userEvent.click(screen.getByRole("checkbox", { name: "Not aware about the exam" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(screen.getByLabelText("Details")).toBeRequired();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Describe the other reason.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Details"), "Family moved this month");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const body = sentForm();
    expect(body.get("status")).toBe("not_filled");
    expect(body.getAll("reasons")).toEqual(["not_aware", "other"]);
    expect(body.get("details")).toBe("Family moved this month");
    expect(body.has("applicationNumber")).toBe(false);
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe("JeeFormCard once recorded", () => {
  it("shows Filled with the number, the PDF link and the ticked reminder", () => {
    render(
      <JeeFormCard
        studentId={501}
        form={{ current: FILLED, earlier: [], reminderItems: [{ ...REMINDER_OPEN, status: "done" }] }}
        canRecord={false}
      />
    );

    const card = screen.getByRole("region", { name: "JEE Main 2027 form" });
    expect(within(card).getByText("Filled")).toBeInTheDocument();
    expect(within(card).getByText("270310000001")).toHaveClass("font-mono");
    expect(within(card).getByRole("link", { name: "View PDF" })).toHaveAttribute(
      "href",
      "/api/blended-learning/students/501/jee-form/confirmation"
    );
    expect(within(card).getByText("JEE Form Filling (Reminder)")).toHaveClass("line-through");
    expect(within(card).getByText("Done")).toBeInTheDocument();
    expect(within(card).getByText(/Recorded/)).toHaveTextContent("Recorded 10 Nov 2026");
    expect(within(card).queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  });

  it("shows Not filled with its reasons, details and the program team's flag, and earlier updates", async () => {
    render(<JeeFormCard studentId={501} form={{ current: NOT_FILLED, earlier: [FILLED], reminderItems: [] }} canRecord />);

    expect(screen.getByText("Not filled")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Reasons" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Certificate is not available",
      "Other",
    ]);
    expect(screen.getByText("Waiting for the income certificate")).toBeInTheDocument();
    expect(screen.getByText("Flagged to the program team")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Earlier updates (1)"));
    expect(screen.getByText(/Filled · 270310000001/)).toBeInTheDocument();
  });

  it("lets a recorder change the status from the saved values, or cancel", async () => {
    render(<JeeFormCard studentId={501} form={{ current: NOT_FILLED, earlier: [], reminderItems: [] }} canRecord />);
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));

    expect(screen.getByRole("radio", { name: "Not filled" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Other" })).toBeChecked();
    expect(screen.getByLabelText("Details")).toHaveValue("Waiting for the income certificate");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Flagged to the program team")).toBeInTheDocument();
  });
});
