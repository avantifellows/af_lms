import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JeeFormUpdate, JeeFormView } from "@/lib/blended-learning-jee-form-input";

import { JeeFormPanel } from "./JeeFormPanel";

const REMINDER_OPEN = { id: 81, text: "JEE Form Filling (Reminder)", status: "open" as const };
const EMPTY: JeeFormView = { current: null, earlier: [], reminderItems: [REMINDER_OPEN], passwordSaved: false };
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
  passwordSaved: true,
};
// A fake exam-portal password, as a Mentor would type it.
const TYPED = "fake-portal-pass-1";

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
  it("opens straight to the choice; Filled asks for a required, masked, write-only password", async () => {
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
    const password = screen.getByLabelText("Exam portal password");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show typed password" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("is prefilled from what is saved, and Cancel closes the row", async () => {
    panel({ current: NOT_FILLED, earlier: [], reminderItems: [], passwordSaved: false });

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

  it("needs an application number and, while none is saved, the password before posting", async () => {
    panel(EMPTY);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter the application number.")).toBeInTheDocument();
    expect(screen.getByText("Enter the exam portal password.")).toBeInTheDocument();

    // A number alone is still not enough: no partial details now, password later.
    await userEvent.type(screen.getByLabelText("Application number"), "270310000001");
    await userEvent.type(screen.getByLabelText("Exam portal password"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter the exam portal password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Exam portal password")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the number and the PDF, then shows what was saved with the ticked reminder", async () => {
    const { rerender } = panel(EMPTY);
    await userEvent.click(screen.getByRole("radio", { name: "Filled" }));
    expect(screen.getByText(/Saving ticks the student's “JEE Form Filling \(Reminder\)” action item/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Application number"), "270310000001");
    await userEvent.type(screen.getByLabelText("Exam portal password"), TYPED);
    const pdf = new File(["%PDF-"], "confirmation.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Confirmation page/), pdf);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const body = sentForm();
    expect([...body.keys()].sort()).toEqual(["applicationNumber", "confirmation", "password", "status"]);
    expect(body.get("status")).toBe("filled");
    expect(body.get("password")).toBe(TYPED);
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
    // Only that a password is saved; the typed one is gone with the draft.
    expect(screen.getByText("Saved", { selector: "span" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(TYPED);
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("radio", { name: "Filled" })).toBeChecked();
    expect(screen.getByText("Password saved")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exam portal password")).not.toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText("Exam portal password"), TYPED);
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
    await userEvent.type(screen.getByLabelText("Exam portal password"), TYPED);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Check your connection and try again.");
  });
});

describe("JeeFormPanel with a password already saved", () => {
  it("shows Password saved, posts without a password to keep it, and offers Replace", async () => {
    panel(SAVED_FILLED);
    expect(screen.getByText("Password saved")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exam portal password")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sentForm().has("password")).toBe(false);
  });

  it("replaces it only when a new one is typed; blank keeps the saved one", async () => {
    panel(SAVED_FILLED);
    await userEvent.click(screen.getByRole("button", { name: "Replace password" }));
    const field = screen.getByLabelText(/Exam portal password/);
    expect(field).not.toBeRequired();
    await userEvent.click(screen.getByRole("button", { name: "Keep saved password" }));
    expect(screen.getByText("Password saved")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Replace password" }));
    await userEvent.type(screen.getByLabelText(/Exam portal password/), "fake-new-pass-2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sentForm().get("password")).toBe("fake-new-pass-2");
  });

  it("reveals it on Show password through the logged POST, and Hide forgets it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ password: "fake-revealed-3" }), { status: 200 }));
    panel(SAVED_FILLED);
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));

    expect(await screen.findByText("fake-revealed-3")).toHaveClass("font-mono");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/blended-learning/students/501/jee-form/password");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.queryByText("fake-revealed-3")).not.toBeInTheDocument();
  });

  it("says so when the reveal is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    panel(SAVED_FILLED, false);
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
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

  it("shows Filled with the number, PDF link and Show password, without Change status", () => {
    panel(SAVED_FILLED, false);
    expect(screen.getByText("270310000001")).toHaveClass("font-mono");
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  });

  it("says Not saved for a Filled form without a password, with nothing to reveal", () => {
    panel({ ...SAVED_FILLED, passwordSaved: false }, false);
    expect(screen.getByText("Not saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument();
  });

  it("shows Not filled with its reasons, details and flag, and earlier updates", async () => {
    panel({ current: NOT_FILLED, earlier: [FILLED], reminderItems: [], passwordSaved: false }, false);

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
