import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JeeFormUpdate, JeeFormView } from "@/lib/blended-learning-jee-form-input";

import { JeeFormPanel } from "./JeeFormPanel";

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
const SAVED_FILLED: JeeFormView = {
  current: FILLED,
  earlier: [NOT_FILLED],
  reminderItems: [{ ...REMINDER_OPEN, status: "done" }],
};

let fetchMock: ReturnType<typeof vi.fn>;
const onSaved = vi.fn();
const onClose = vi.fn();

function sentForm(): FormData {
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/blended-learning/students/501/jee-form");
  expect(init.method).toBe("POST");
  return init.body as FormData;
}

function panel(form: JeeFormView, canRecord = true) {
  return render(<JeeFormPanel studentId={501} form={form} canRecord={canRecord} onSaved={onSaved} onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ form: SAVED_FILLED }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JeeFormPanel for a recorder", () => {
  it("opens straight to the choice, with no password field anywhere", async () => {
    panel(EMPTY);

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

  it("is prefilled from what is saved, and Cancel closes the row", async () => {
    panel({ current: NOT_FILLED, earlier: [], reminderItems: [] });

    expect(screen.getByRole("radio", { name: "Not filled" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Other" })).toBeChecked();
    expect(screen.getByLabelText("Details")).toHaveValue("Waiting for the income certificate");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("links the saved confirmation page from the Filled form", () => {
    panel(SAVED_FILLED);
    expect(screen.getByRole("link", { name: "View PDF" })).toHaveAttribute(
      "href",
      "/api/blended-learning/students/501/jee-form/confirmation"
    );
  });

  it("needs an application number before posting", async () => {
    panel(EMPTY);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter the application number.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the number and the PDF, then shows what was saved with the ticked reminder", async () => {
    const { rerender } = panel(EMPTY);
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
    expect(onSaved).toHaveBeenCalledWith(SAVED_FILLED);

    // The tab passes the saved form back down.
    rerender(<JeeFormPanel studentId={501} form={SAVED_FILLED} canRecord onSaved={onSaved} onClose={onClose} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByText("270310000001")).toHaveClass("font-mono");
    expect(screen.getByText("JEE Form Filling (Reminder)")).toHaveClass("line-through");
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText(/^Recorded/)).toHaveTextContent("Recorded 10 Nov 2026");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("radio", { name: "Filled" })).toBeChecked();
  });

  it("refuses a confirmation that isn't a PDF in the browser", async () => {
    panel(EMPTY);
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
    panel(EMPTY);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.type(screen.getByLabelText("Application number"), "2703");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This application number is already saved for JEE Advanced.")).toBeInTheDocument();
    expect(screen.getByLabelText("Application number")).toHaveValue("2703");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says so when the save can't reach the server", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    panel(EMPTY);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.type(screen.getByLabelText("Application number"), "2703");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Check your connection and try again.");
  });
});

describe("JeeFormPanel recording Not filled", () => {
  it("offers the eleven reasons and needs at least one", async () => {
    panel(EMPTY);
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
    panel(EMPTY);
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
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("JeeFormPanel for a read-only viewer", () => {
  it("says Not recorded yet, with no controls", () => {
    panel(EMPTY, false);
    expect(screen.getByText("Not recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Filled with the number and PDF link, without Change status", () => {
    panel(SAVED_FILLED, false);
    expect(screen.getByText("270310000001")).toHaveClass("font-mono");
    expect(screen.getByRole("link", { name: "View PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  });

  it("shows Not filled with its reasons, details and flag, and earlier updates", async () => {
    panel({ current: NOT_FILLED, earlier: [FILLED], reminderItems: [] }, false);

    expect(within(screen.getByRole("list", { name: "Reasons" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Certificate is not available",
      "Other",
    ]);
    expect(screen.getByText("Waiting for the income certificate")).toBeInTheDocument();
    expect(screen.getByText("Flagged to the program team")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Earlier updates (1)"));
    expect(screen.getByText(/Filled · 270310000001/)).toBeInTheDocument();
  });
});
