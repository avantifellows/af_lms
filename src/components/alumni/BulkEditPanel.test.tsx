import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BulkEditPanel, { type BulkStudent } from "./BulkEditPanel";

// The college/branch search has its own test; here it's a plain text box.
vi.mock("./ReferencePicker", () => ({
  default: ({ id, onChange }: { id: string; onChange: (code: string, name: string) => void }) => (
    <input aria-label={`picker ${id}`} onChange={(e) => onChange(e.target.value, `Name of ${e.target.value}`)} />
  ),
}));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const STUDENTS: BulkStudent[] = [
  { kind: "alumnus", id: "8340", name: "Ampoli Ram" },
  { kind: "pass-out", id: "86655", name: "Bhanu" },
];
const COMMON = {
  total: 2,
  common: { ug_status: "Studying" },
  names: {},
  mixed: { degree_ug: 1 },
  gates: [{ ug_status: "Studying" }, { ug_status: "Studying" }],
};
const result = (id: string, kind: "alumnus" | "pass-out", outcome: string, extra: object = {}) => ({
  target: { kind, id }, name: "", result: outcome, changed: ["Contact status"], kept: [], ...extra,
});

/** POST bodies sent to the bulk route. */
const bulkBodies = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/alumni/bulk").map(([, init]) => JSON.parse(init.body));

function server(check: object[], save: object[] = check) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (url === "/api/alumni/bulk/common") return json(COMMON);
    const body = JSON.parse(init.body as string);
    return json({ results: body.dryRun ? check : save });
  });
}

const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("BulkEditPanel", () => {
  it("starts from what they share, checks, then saves the ones that can be saved", async () => {
    server([result("8340", "alumnus", "update"), result("86655", "pass-out", "create")]);
    const onDone = vi.fn();
    render(<BulkEditPanel students={STUDENTS} onDone={onDone} />);

    expect(await screen.findByText("Edit 2 students together")).toBeInTheDocument();
    expect(screen.getByText(/1 not added yet/)).toBeInTheDocument();
    expect(screen.getByText("Already filled for all 2")).toBeInTheDocument();
    expect(screen.getByText(/Degree \(1 of 2\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check 2 students" })).toBeDisabled();
    expect(screen.getByText("Fill in at least one answer.")).toBeInTheDocument();

    select("Contact status", "Not Contacted");
    fireEvent.click(screen.getByRole("button", { name: "Check 2 students" }));
    expect(await screen.findByText(/Check result/)).toBeInTheDocument();
    expect(screen.getByText("1 will be updated")).toBeInTheDocument();
    expect(screen.getByText("1 will be added (new record)")).toBeInTheDocument();
    expect(bulkBodies()[0]).toMatchObject({ values: { contact_status: "Not Contacted" }, dryRun: true, overwrite: false });

    fireEvent.click(screen.getByRole("button", { name: "Save 2 students" }));
    expect(await screen.findByText("Saved to the alumni table")).toBeInTheDocument();
    expect(bulkBodies()[1]).toMatchObject({ dryRun: false, confirmed: [] });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("unusual answers are saved only once accepted", async () => {
    const warning = { id: "w1", field: "contact_status", message: "Looks odd.", level: "confirm" };
    server([result("8340", "alumnus", "update"), result("86655", "pass-out", "confirm", { warnings: [warning] })]);
    render(<BulkEditPanel students={STUDENTS} onDone={vi.fn()} />);
    await screen.findByLabelText("Contact status");
    select("Contact status", "Not Contacted");
    fireEvent.click(screen.getByRole("button", { name: "Check 2 students" }));
    expect(await screen.findByText("Looks odd.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 1 student" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/They.re correct/));
    fireEvent.click(screen.getByRole("button", { name: "Save 2 students" }));
    await waitFor(() => expect(bulkBodies()[1]).toMatchObject({ confirmed: ["w1"] }));
  });

  it("a shared answer can be reopened and replaced; 'Also replace' is sent", async () => {
    server([result("8340", "alumnus", "unchanged"), result("86655", "pass-out", "error", { message: "No access", name: "Bhanu" })]);
    render(<BulkEditPanel students={STUDENTS} onDone={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change Undergraduate (UG) status" }));
    select("Undergraduate (UG) status", "Graduated");
    fireEvent.click(screen.getByLabelText(/Also replace answers already on record/));
    fireEvent.click(screen.getByRole("button", { name: "Check 2 students" }));
    expect(await screen.findByText("1 can't be saved")).toBeInTheDocument();
    expect(screen.getByText(/No access/)).toBeInTheDocument();
    expect(bulkBodies()[0]).toMatchObject({ values: { ug_status: "Graduated" }, replace: ["ug_status"], overwrite: true });
    fireEvent.click(screen.getByRole("button", { name: "Change answers" }));
    expect(screen.getByRole("button", { name: "Check 2 students" })).toBeEnabled();
  });

  it("starts blank when it can't load what they share, and reports a failed chunk per student", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/alumni/bulk/common") return json({ error: "no" }, 500);
      return json({ error: "Server down" }, 500);
    });
    render(<BulkEditPanel students={STUDENTS} onDone={vi.fn()} />);
    expect(await screen.findByText(/form starts blank/)).toBeInTheDocument();
    select("Contact status", "Not Contacted");
    fireEvent.click(screen.getByRole("button", { name: "Check 2 students" }));
    expect(await screen.findByText("2 can't be saved")).toBeInTheDocument();
    expect(screen.getByText(/Ampoli Ram/)).toBeInTheDocument();
    expect(screen.getAllByText(/Server down/)).toHaveLength(2);
  });
});
