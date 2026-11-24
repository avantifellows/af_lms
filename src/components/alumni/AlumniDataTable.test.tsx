import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AlumniDataTable, { tableQuery } from "./AlumniDataTable";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The form, the bulk panel and the branch search have their own tests.
vi.mock("./AlumniForm", () => ({
  default: ({ entry }: { entry: { kind: string; id: string } }) => <div>form for {entry.kind} {entry.id}</div>,
}));
vi.mock("./BulkEditPanel", () => ({
  default: ({ students, onDone, onBusyChange, onSaved }: {
    students: { id: string }[];
    onDone: () => void;
    onBusyChange: (busy: boolean) => void;
    onSaved: () => void;
  }) => (
    <div>
      bulk for {students.map((s) => s.id).join(",")}
      <button type="button" onClick={() => onBusyChange(true)}>start saving</button>
      <button type="button" onClick={() => { onBusyChange(false); onSaved(); }}>saving done</button>
      <button type="button" onClick={onDone}>finish bulk</button>
    </div>
  ),
}));
vi.mock("./ReferencePicker", () => ({
  default: ({ id, onChange }: { id: string; onChange: (code: string) => void }) => (
    <input aria-label={`picker ${id}`} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { toast } from "sonner";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const EMPTY = { contact_status: "", current_status: "", ug_status: "", college_id_ug: "", branch_id_ug: "", degree_ug: "", employment_status: "" };
const ROWS = [
  {
    kind: "alumnus", id: "8340", name: "Ampoli Ram", afid: "263", phone: "", whatsapp: "", cohortYear: "2025-2026", program: "",
    schoolCode: "59525", schoolName: "JNV Adilabad", values: { ...EMPTY, ug_status: "Studying" }, filledPct: 80,
    missing: ["branch_id_ug"], updatedAt: "",
  },
  {
    kind: "pass-out", id: "86655", name: "Bhanu", afid: "", phone: "", whatsapp: "", cohortYear: "2025-2026", program: "",
    schoolCode: "59525", schoolName: "JNV Adilabad", values: EMPTY, filledPct: 0, missing: ["contact_status"], updatedAt: "",
  },
];
const PAGE = {
  rows: ROWS, total: 2, page: 1, pageCount: 2, years: ["2025-2026"],
  schools: [{ code: "59525", name: "JNV Adilabad" }],
  summary: { total: 2, notAdded: 1, missing: { ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, 0])), contact_status: 1, branch_id_ug: 1 } },
};

/** The table loads after a 300 ms typing pause: allow for a slow first render. */
const LOAD = { timeout: 5000 };
const tableCalls = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith("/api/alumni/table?"));

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return json({ results: [{ result: "update" }] });
    if (url.includes("refs=1")) return json({ refs: ROWS.map((r) => ({ kind: r.kind, id: r.id, name: r.name })) });
    return json(PAGE);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("tableQuery", () => {
  it("builds the query the routes read", () => {
    const filters = { year: "2024-2025", record: "added" as const, school: "1", q: " ram ", fields: { college_id_ug: "missing" as const, ug_status: undefined } };
    expect(tableQuery(filters, undefined, 2)).toBe("school=1&year=2024-2025&record=added&q=ram&college_id_ug=missing&page=2");
    expect(tableQuery({ year: "", record: "", school: "9", q: "", fields: {} }, "59525")).toBe("school=59525");
  });
});

describe("AlumniDataTable", () => {
  it("shows the rows with what's missing, not applying, and how complete", async () => {
    render(<AlumniDataTable schoolCode="59525" />);
    const ampoli = (await screen.findByRole("button", { name: "Ampoli Ram" }, LOAD)).closest("tr")!;
    expect(within(ampoli).getByText("Added")).toBeInTheDocument();
    expect(within(ampoli).getByText("80%")).toBeInTheDocument();
    expect(within(ampoli).getAllByTitle("Missing")).toHaveLength(1);
    expect(within(screen.getByText("Bhanu").closest("tr")!).getByText("no AFID")).toBeInTheDocument();
    expect(screen.getByText("2 people")).toBeInTheDocument();
    expect(tableCalls()[0]).toBe("/api/alumni/table?school=59525");
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", "/api/alumni/table/export?school=59525");
  });

  it("a summary chip filters, and the pager moves pages", async () => {
    render(<AlumniDataTable />);
    fireEvent.click(await screen.findByRole("button", { name: "1 missing contact status" }, LOAD));
    await waitFor(() => expect(tableCalls().at(-1)).toBe("/api/alumni/table?contact_status=missing"));
    fireEvent.click(await screen.findByRole("button", { name: "1 not added yet" }));
    await waitFor(() => expect(tableCalls().at(-1)).toContain("record=not-added"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(tableCalls().at(-1)).toContain("page=2"));
  });

  it("ticks students (one, a page, everyone matching) and edits them together", async () => {
    render(<AlumniDataTable />);
    fireEvent.click(await screen.findByLabelText("Select Ampoli Ram", {}, LOAD));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all 2 matching" }));
    expect(await screen.findByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByLabelText("Select this page"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit 2 selected" }));
    expect(screen.getByText("bulk for 8340,86655")).toBeInTheDocument();

    // While saving, the popup can't be closed (no X, Esc ignored).
    fireEvent.click(screen.getByRole("button", { name: "start saving" }));
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("bulk for 8340,86655")).toBeInTheDocument();

    // A finished save reloads the table at once; closing the popup any way then clears the selection.
    const loads = tableCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "saving done" }));
    await waitFor(() => expect(tableCalls().length).toBe(loads + 1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("bulk for 8340,86655")).not.toBeInTheDocument();
    expect(screen.getByText(/Tick students to fill in/)).toBeInTheDocument();
  });

  it("closing bulk edit without saving keeps the selection", async () => {
    render(<AlumniDataTable />);
    fireEvent.click(await screen.findByLabelText("Select Ampoli Ram", {}, LOAD));
    fireEvent.click(screen.getByRole("button", { name: "Edit 1 selected" }));
    fireEvent.click(screen.getByRole("button", { name: "finish bulk" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("opens a record from its row", async () => {
    render(<AlumniDataTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Bhanu" }, LOAD));
    expect(screen.getByText("form for pass-out 86655")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("form for pass-out 86655")).not.toBeInTheDocument();
  });

  it("picks a branch right in the table", async () => {
    render(<AlumniDataTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Pick branch for Ampoli Ram" }, LOAD));
    fireEvent.change(screen.getByLabelText("picker branch-8340"), { target: { value: "CSIT057" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Branch saved: Ampoli Ram"));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(init.body)).toEqual({
      targets: [{ kind: "alumnus", id: "8340" }], values: { branch_id_ug: "CSIT057" }, overwrite: true, dryRun: false,
    });
  });

  it("view-only: no ticking or branch picking; and shows a load error", async () => {
    fetchMock.mockResolvedValue(json({ error: "Access denied" }, 403));
    render(<AlumniDataTable canEdit={false} />);
    expect(await screen.findByText("Access denied", {}, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/Tick students/)).not.toBeInTheDocument();
  });
});
