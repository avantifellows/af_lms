import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AlumniForm from "./AlumniForm";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
// The college/branch search has its own test; here it's a plain text box.
vi.mock("./ReferencePicker", () => ({
  default: ({ id, code, onChange }: { id: string; code: string; onChange: (code: string, name: string) => void }) => (
    <input id={id} aria-label={`picker ${id}`} value={code} onChange={(e) => onChange(e.target.value, `Name of ${e.target.value}`)} />
  ),
}));

import { toast } from "sonner";

const fetchMock = vi.fn();
type Ctx = Record<string, unknown>;

function context(overrides: Ctx = {}): Ctx {
  return {
    kind: "new",
    ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "" },
    name: "Ampoli Ram Charan",
    afid: "2632401171",
    program: "JNV CoE",
    school: "JNV Adilabad",
    cohortYear: "2025-2026",
    profile: { user_gender: "Female", student_g12_graduating_year: "2026" },
    alumni: {},
    codeNames: {},
    ...overrides,
  };
}

const PASS_OUT = { kind: "pass-out" as const, id: "86655" };
const ALUMNUS = { kind: "alumnus" as const, id: "8340" };

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** GET returns `ctx`; each POST takes the next reply from `posts`. */
function server(ctx: Ctx, posts: Array<ReturnType<typeof json> | Error> = []) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return json(ctx);
    const next = posts.shift();
    if (next instanceof Error) throw next;
    return next ?? json({ error: "no reply" }, 500);
  });
}

const select = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const postedBody = (i = 0) => JSON.parse(posts()[i][1].body as string);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.info).mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AlumniForm", () => {
  it("shows the student, their ids and the starting questions", async () => {
    server(context());
    render(<AlumniForm entry={PASS_OUT} />);

    expect(await screen.findByRole("heading", { name: "Ampoli Ram Charan" })).toBeInTheDocument();
    expect(screen.getByText("New alumni entry")).toBeInTheDocument();
    expect(screen.getByText("2632401171")).toBeInTheDocument();
    expect(screen.getByLabelText("Undergraduate (UG) status")).toBeInTheDocument();
    expect(screen.queryByLabelText("Start year")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/alumni/pass-out/86655");
  });

  it("shows why a student couldn't be loaded", async () => {
    fetchMock.mockResolvedValue(json({ error: "Access denied" }, 403));
    render(<AlumniForm entry={PASS_OUT} />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
  });

  it("opens the UG section as answers come in, and fills the gap year from a Gap Year status", async () => {
    server(context());
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });

    select("Undergraduate (UG) status", "Studying");
    expect(screen.getByLabelText("Start year")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    select("Current status", "Gap Year");
    expect(screen.getByLabelText<HTMLSelectElement>("Took a gap year?").value).toBe("Yes");
    expect(toast.info).toHaveBeenCalledWith('"Took a gap year?" set to Yes', expect.anything());
  });

  it("blocks impossible answers without sending anything", async () => {
    server(context());
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });

    select("Undergraduate (UG) status", "Graduated");
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Graduation year"), { target: { value: "2028" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/field.* need fixing/)).toBeInTheDocument();
    expect(screen.getByText(/2028 is in the future/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);

    // Changing the field clears its error.
    fireEvent.change(screen.getByLabelText("Graduation year"), { target: { value: "2025" } });
    expect(screen.queryByText(/2028 is in the future/)).not.toBeInTheDocument();
  });

  it("asks to confirm unusual answers, can go back, and saves once confirmed", async () => {
    const onSaved = vi.fn();
    server(context(), [json({ ok: true, action: "inserted", alumniId: "8340", changed: ["UG status", "Start year"], notCleared: [] })]);
    render(<AlumniForm entry={PASS_OUT} onSaved={onSaved} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });

    select("Undergraduate (UG) status", "Studying");
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2025" } });
    expect(screen.getByText(/You'll be asked to confirm/)).toBeInTheDocument();
    expect(screen.getByText(/1 answer to confirm/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("This answer looks unusual");
    fireEvent.click(screen.getByRole("button", { name: "Go back and fix" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, it's correct/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(postedBody()).toEqual({
      values: { ug_status: "Studying", start_year_ug: "2025" },
      confirmed: ["ug-before-g12"],
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Added to the alumni table — Ampoli Ram Charan",
      expect.objectContaining({ description: "alumni_id 8340 · 2 fields written." }),
    );
    // Reloads the record after saving — the pass-out is now alumnus 8340.
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/alumni/8340"));
  });

  it("shows warnings the server asks to confirm", async () => {
    server(context(), [json({ error: "confirm", warnings: [{ id: "x", level: "warning", field: "ug_status", fields: [], message: "Server says check this." }] }, 409)]);
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });
    select("Undergraduate (UG) status", "Studying");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Server says check this.")).toBeInTheDocument();
  });

  it("shows the server's errors, and a connection problem", async () => {
    server(context(), [
      json({ error: "Some fields need fixing.", fieldErrors: { ug_status: "Server rejected this." } }, 400),
      new Error("offline"),
    ]);
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });
    select("Undergraduate (UG) status", "Studying");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Server rejected this.")).toBeInTheDocument();

    select("Undergraduate (UG) status", "Graduated");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument();
  });

  it("narrows the degree list to the branch and flags a degree that doesn't fit", async () => {
    server(context({ alumni: { ug_status: "Studying", branch_id_ug: "CSIT057" }, codeNames: { branch_id_ug: "Computer Science" } }));
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });

    const degree = screen.getByLabelText<HTMLSelectElement>("Degree");
    const options = [...degree.options].map((o) => o.value);
    expect(options).toContain("BTech/BE");
    expect(options).not.toContain("MBBS");
    expect(screen.getByText("Showing degrees that fit Computer Science.")).toBeInTheDocument();

    // Pick a degree that fits, then change the branch to one it doesn't fit.
    fireEvent.change(screen.getByLabelText("Degree"), { target: { value: "BTech/BE" } });
    fireEvent.change(screen.getByLabelText("picker f-branch_id_ug"), { target: { value: "MBBS" } });
    expect(screen.getByText(/Doesn't match the branch/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BTech/BE (doesn't fit the branch)" })).toBeInTheDocument();
  });

  it("explains an old record: notes, values that no longer fit, and off-list values", async () => {
    server(
      context({
        kind: "edit",
        ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "8340" },
        alumni: {
          ug_status: "Gap Year",
          college_id_ug: "C-19609",
          degree_ug: "BTech/BE",
          branch_id_ug: "ELEC067",
          start_year_ug: "2013",
          year_of_graduation_ug: "2022",
          contact_status: "Old status",
        },
        codeNames: { college_id_ug: "Nalla Malla Reddy" },
        profile: { student_g12_graduating_year: "2012" },
      }),
    );
    render(<AlumniForm entry={ALUMNUS} />);

    expect(await screen.findByText("Edit alumni record")).toBeInTheDocument();
    expect(screen.getByText(/never erases what's on record/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getAllByText(/stays on record/).length).toBeGreaterThan(0);
    expect(screen.getByText(/On record: BTech\/BE takes 4 years/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Old status (current value, not in list)" })).toBeInTheDocument();
  });

  it("lets a newly typed value that no longer fits be cleared", async () => {
    server(context());
    render(<AlumniForm entry={PASS_OUT} />);
    await screen.findByRole("heading", { name: "Ampoli Ram Charan" });

    select("Undergraduate (UG) status", "Studying");
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2026" } });
    select("Undergraduate (UG) status", "Gap Year");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByLabelText("Start year")).not.toBeInTheDocument();
  });
});
