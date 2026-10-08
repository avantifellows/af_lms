import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SetupModal from "./SetupModal";
import type { Cycle } from "./types";

const CENTRE = { id: 7, name: "JNV Kurnool CoE", typeCode: "coe" };
const BATCHES = [
  { id: 1, name: "Grade 12 quiz batch", batch_id: "PARENT_12", parent_id: 100, program_id: 1 },
  { id: 2, name: "2027 Engineering", batch_id: "B27", parent_id: 1, program_id: 1 },
  { id: 3, name: "2028 Engineering", batch_id: "B28", parent_id: 1, program_id: 1 },
];
const TEACHERS = [
  { id: "T1", name: "Indrani Khan", role: "teacher", subject: "Chemistry" },
  { id: null, name: "Manish Kumar", role: null, subject: null },
];

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let setupResponse: () => Promise<Response>;

function cycle(overrides: Partial<Cycle> = {}): Cycle {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return {
    setupRunId: "run-1",
    cycleLabel: "This month",
    centreName: CENTRE.name,
    batchClassIds: ["B27"],
    batchClassNames: ["2027 Engineering"],
    startTime: now,
    endTime: now,
    createdBy: "pm@avantifellows.org",
    createdAt: now,
    teachers: [],
    ...overrides,
  };
}

function renderModal(props: Partial<Parameters<typeof SetupModal>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onExtendInstead: vi.fn() };
  render(
    <SetupModal
      schoolCode="59324"
      centres={[CENTRE]}
      cycles={[]}
      loading={false}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

async function pickBatchAndTeacher() {
  fireEvent.click(await screen.findByRole("checkbox", { name: "2027 Engineering" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Indrani Khan/ }));
}

beforeEach(() => {
  setupResponse = () => json({ cycleLabel: "Oct 2026", createdCount: 1, failedCount: 0 }, 201);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.startsWith("/api/teacher-feedback/teachers")) return json({ teachers: TEACHERS });
      if (input.startsWith("/api/teacher-feedback/batches")) return json({ batches: BATCHES });
      if (input === "/api/teacher-feedback/setup") return setupResponse();
      return json({}, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SetupModal", () => {
  it("auto-selects the only centre and lists its class batches and teachers", async () => {
    renderModal();

    expect(await screen.findByRole("checkbox", { name: "2027 Engineering" })).toBeInTheDocument();
    // The quiz (parent) batch is not a class batch.
    expect(screen.queryByRole("checkbox", { name: "Grade 12 quiz batch" })).not.toBeInTheDocument();
    expect(await screen.findByText("Chemistry")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/teacher-feedback/teachers?centre_id=7", expect.anything());
  });

  it("asks for a centre when the school has several", () => {
    renderModal({ centres: [CENTRE, { id: 8, name: "Nodal", typeCode: "nodal" }] });

    expect(screen.getAllByText("Select a centre first.")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "8" } });
    expect(fetch).toHaveBeenCalledWith("/api/teacher-feedback/batches?centre_id=8", expect.anything());
  });

  it("shows loading and empty centre states", () => {
    const { unmount } = render(
      <SetupModal schoolCode="1" centres={[]} cycles={[]} loading onClose={vi.fn()} onDone={vi.fn()} onExtendInstead={vi.fn()} />
    );
    expect(screen.getByText("Loading centres…")).toBeInTheDocument();
    unmount();
    renderModal({ centres: [] });
    expect(screen.getByText("No active centre is linked to this school.")).toBeInTheDocument();
  });

  it("shows the batches route's reason when a centre has none", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("batches")
        ? json({ batches: [], reason: "This centre has no programme." })
        : json({ teachers: [] })
    );
    renderModal();

    expect(await screen.findByText("This centre has no programme.")).toBeInTheDocument();
    expect(await screen.findByText("No teachers found for this centre.")).toBeInTheDocument();
  });

  it("says so when batches fail to load", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("batches") ? Promise.reject(new Error("down")) : Promise.reject(new Error("down"))
    );
    renderModal();

    expect(await screen.findByText("Failed to load batches for this centre.")).toBeInTheDocument();
  });

  it("creates forms for the picked batches and teachers, starting now for 24 hours", async () => {
    const { onDone } = renderModal();
    await pickBatchAndTeacher();
    fireEvent.click(screen.getByRole("checkbox", { name: /Manish Kumar/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Manish Kumar/ })); // and back off
    fireEvent.click(screen.getByRole("button", { name: "Create Feedback Forms" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ cycleLabel: "Oct 2026", createdCount: 1, failedCount: 0 }));
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/teacher-feedback/setup")!;
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({
      schoolCode: "59324",
      centreId: 7,
      parentBatchId: "PARENT_12",
      classBatchIds: ["B27"],
      teachers: [{ id: "T1", name: "Indrani Khan", order: 1 }],
    });
    expect(new Date(body.endTime).getTime() - new Date(body.startTime).getTime()).toBe(24 * 3600_000);
  });

  it("keeps Create disabled until a batch and a teacher are picked", async () => {
    renderModal();
    const create = screen.getByRole("button", { name: "Create Feedback Forms" });
    expect(create).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "2027 Engineering" }));
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "2027 Engineering" }));
  });

  it("rejects a schedule that ends before it starts", async () => {
    renderModal();
    await pickBatchAndTeacher();
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    const [start, end] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(start, { target: { value: "2026-11-02T10:00" } });
    fireEvent.change(end, { target: { value: "2026-11-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Feedback Forms" }));

    expect(screen.getByText("End time must be after start time.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/teacher-feedback/setup", expect.anything());
  });

  it("shows the server's error, and a generic one when the request fails", async () => {
    setupResponse = () => json({ error: "Teacher already set up" }, 409);
    renderModal();
    await pickBatchAndTeacher();
    fireEvent.click(screen.getByRole("button", { name: "Create Feedback Forms" }));
    expect(await screen.findByText("Teacher already set up")).toBeInTheDocument();

    setupResponse = () => Promise.reject(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Create Feedback Forms" }));
    expect(await screen.findByText("Setup request failed")).toBeInTheDocument();
  });

  it("nudges to extend when a picked batch already had a round this month", async () => {
    const { onExtendInstead } = renderModal({
      cycles: [cycle(), cycle({ setupRunId: "other", batchClassIds: ["B28"], batchClassNames: ["2028 Engineering"] })],
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: "2027 Engineering" }));

    expect(screen.getByText(/already had feedback/)).toHaveTextContent("this month");
    expect(screen.getAllByRole("button", { name: "Go to that round" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Go to that round" }));
    expect(onExtendInstead).toHaveBeenCalledWith("run-1");
  });

  it("checks the scheduled month, not today's, for the nudge", async () => {
    renderModal({ cycles: [cycle()] });
    fireEvent.click(await screen.findByRole("checkbox", { name: "2027 Engineering" }));
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    const [start] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(start, { target: { value: "2031-01-15T10:00" } });

    expect(screen.queryByText(/already had feedback/)).not.toBeInTheDocument();
  });

  it("closes from the header and the Cancel button", () => {
    const { onClose } = renderModal({ centres: [] });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
