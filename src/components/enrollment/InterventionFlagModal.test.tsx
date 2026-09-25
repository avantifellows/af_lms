import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InterventionFlag } from "@/lib/intervention-flag-types";
import InterventionFlagModal from "./InterventionFlagModal";

const OPEN_FLAG: InterventionFlag = {
  id: 9,
  student_pk_id: "5",
  status: "open",
  raised_by_email: "teacher@avantifellows.org",
  inserted_at: "2026-09-25T05:00:00Z",
  resolved_at: null,
  updates: [
    {
      id: 1,
      author_email: "teacher@avantifellows.org",
      author_name: "Asha Teacher",
      body: "Lost a parent last week",
      status_from: null,
      status_to: "open",
      inserted_at: "2026-09-25T05:00:00Z",
    },
  ],
};

const fetchMock = vi.fn();

function renderModal(flags: InterventionFlag[], onChanged = vi.fn()) {
  render(
    <InterventionFlagModal
      open
      onClose={vi.fn()}
      onChanged={onChanged}
      schoolCode="70705"
      studentPkId="5"
      studentName="Ravi Kumar"
      flags={flags}
    />,
  );
  return { onChanged };
}

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("InterventionFlagModal", () => {
  it("raises a new flag with the trimmed note", async () => {
    const { onChanged } = renderModal([]);
    const raise = screen.getByRole("button", { name: "Flag for intervention" });
    expect(raise).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "  Needs an eye test  ");
    await userEvent.click(raise);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/schools/70705/intervention-flags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ studentPkId: 5, note: "Needs an eye test" }),
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the open flag's history and adds a note or resolves", async () => {
    renderModal([OPEN_FLAG]);

    expect(screen.getByText("Needs intervention")).toBeInTheDocument();
    expect(screen.getByText("Lost a parent last week")).toBeInTheDocument();
    expect(screen.getByText("Asha Teacher")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "Counsellor visited");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/schools/70705/intervention-flags/9/updates",
      expect.objectContaining({ body: JSON.stringify({ note: "Counsellor visited" }) }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/schools/70705/intervention-flags/9/updates",
      expect.objectContaining({ body: JSON.stringify({ note: "", resolve: true }) }),
    );
  });

  it("shows the server's error and does not report a change", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This student already has an open flag" }),
    });
    const { onChanged } = renderModal([]);

    await userEvent.type(screen.getByRole("textbox"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Flag for intervention" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This student already has an open flag");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("waits for the refetch, then confirms the save", async () => {
    let finishReload: () => void = () => {};
    const onChanged = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)));
    renderModal([], onChanged);

    await userEvent.type(screen.getByRole("textbox"), "Needs counselling");
    await userEvent.click(screen.getByRole("button", { name: "Flag for intervention" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    finishReload();
    expect(await screen.findByRole("status")).toHaveTextContent("Flag saved.");
  });

  it("on a conflict, loads the other flag and keeps the typed text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This student already has an open flag" }),
    });
    const { onChanged } = renderModal([]);

    await userEvent.type(screen.getByRole("textbox"), "My note");
    await userEvent.click(screen.getByRole("button", { name: "Flag for intervention" }));

    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else has already flagged");
    expect(screen.getByRole("textbox")).toHaveValue("My note");
  });

  it("keeps resolved flags under Past flags", () => {
    renderModal([{ ...OPEN_FLAG, id: 3, status: "resolved", resolved_at: "2026-09-26T05:00:00Z" }]);
    expect(screen.getByText("Past flags (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flag for intervention" })).toBeInTheDocument();
  });
});
