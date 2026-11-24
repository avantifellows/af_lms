import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MassRestore from "./MassRestore";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const item = (id: string) => ({
  alumniId: id,
  name: `Alumnus ${id}`,
  school: "JNV Adilabad",
  versionOn: "2026-11-23",
  changes: [{ label: "Contact status", before: "Contacted - Positive Response", after: "Contacted - Unreachable" }],
});
const BULK = {
  id: "40", start: "2026-11-23T10:42:00Z", end: "2026-11-23T10:44:10Z", source: "bulk_upload",
  by: "ravi@avantifellows.org", alumni: 30, note: "",
};
const CALL = {
  id: "12", start: "2026-11-23T05:30:00Z", end: "2026-11-23T05:30:00Z", source: "call",
  by: "priya@avantifellows.org", alumni: 1, note: "Wrong Phone number",
};

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

/** Answers the history list, a preview of `items`, then each restore chunk. */
function server(items: ReturnType<typeof item>[], addedAfter: unknown[] = []) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.history) return json({ groups: [BULK, CALL] });
    if (body.dryRun) return json({ items, addedAfter });
    const results = body.alumniIds.map((alumniId: string) => ({ alumniId, name: "", result: "restored", changed: ["Contact status"] }));
    return json({ results });
  });
}

const openHistory = async () => {
  fireEvent.click(screen.getByRole("button", { name: /History/ }));
  return screen.findByRole("dialog", { name: /Version history/ });
};

describe("MassRestore (version history for many alumni)", () => {
  it("lists the steps newest first, with who, what kind, how many and the remark", async () => {
    server([]);
    render(<MassRestore scope={{ kind: "school", code: "59525" }} scopeLabel="JNV Adilabad" />);
    expect(await openHistory()).toHaveAccessibleName("Version history · JNV Adilabad");
    const steps = await screen.findAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("Bulk edit");
    expect(steps[0]).toHaveTextContent("30 alumni");
    expect(steps[0]).toHaveTextContent("ravi@avantifellows.org");
    expect(steps[1]).toHaveTextContent("“Wrong Phone number”");
    expect(bodies()[0]).toEqual({ scope: { kind: "school", code: "59525" }, history: true });
  });

  it("picking a step previews going back to just before it, then restores in chunks of 25", async () => {
    server(Array.from({ length: 30 }, (_, i) => item(String(i + 1))), [{ alumniId: "99", name: "Late Comer", school: "" }]);
    render(<MassRestore scope={{ kind: "school", code: "59525" }} scopeLabel="JNV Adilabad" />);
    await openHistory();
    fireEvent.click((await screen.findByText("Bulk edit")).closest("button")!);

    expect(await screen.findByText(/would go back to how they were just before this/)).toHaveTextContent("30 alumni");
    expect(screen.getByText(/Late Comer/)).toBeInTheDocument();
    // One second before the step started.
    expect(bodies()[1]).toEqual({ scope: { kind: "school", code: "59525" }, at: "2026-11-23T10:41:59.000Z", dryRun: true });

    fireEvent.click(screen.getByRole("button", { name: "Restore 30 alumni" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, restore" }));
    expect(await screen.findByText(/^Restored/)).toHaveTextContent("Restored 30 alumni");
    const chunks = bodies().filter((b) => b.alumniIds);
    expect(chunks.map((b) => b.alumniIds.length)).toEqual([25, 5]);
    expect(chunks[0].at).toBe("2026-11-23T10:41:59.000Z");
    expect(refresh).toHaveBeenCalled();
    // The list is loaded again, with the restore in it.
    await waitFor(() => expect(bodies().filter((b) => b.history)).toHaveLength(2));
  });

  it("says when everyone is already as they were, and goes back to the list", async () => {
    server([]);
    render(<MassRestore scope={{ kind: "all" }} scopeLabel="all alumni" />);
    await openHistory();
    fireEvent.click((await screen.findByText("“Wrong Phone number”")).closest("button")!);
    expect(await screen.findByText(/nothing to restore/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restore \d/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to history/ }));
    expect(await screen.findByText("Bulk edit")).toBeInTheDocument();
  });

  it("shows a refusal and lists the ones that failed", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ groups: [CALL] }))
      .mockResolvedValueOnce(json({ items: [item("1"), item("2")], addedAfter: [] }))
      .mockResolvedValueOnce(
        json({
          results: [
            { alumniId: "1", name: "Alumnus 1", result: "restored", changed: [] },
            { alumniId: "2", name: "Alumnus 2", result: "error", message: "the DB Service answered 422", changed: [] },
          ],
        }),
      )
      .mockResolvedValue(json({ groups: [CALL] }));
    render(<MassRestore scope={{ kind: "all" }} scopeLabel="all alumni" />);
    await openHistory();
    fireEvent.click((await screen.findByText("“Wrong Phone number”")).closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Restore 2 alumni" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, restore" }));
    await waitFor(() => expect(screen.getByText(/be restored/)).toBeInTheDocument());
    expect(screen.getByText(/Alumnus 2: the DB Service answered 422/)).toBeInTheDocument();
  });

  it("shows when the history can't load", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Restoring all alumni needs access to every school." }, 403));
    render(<MassRestore scope={{ kind: "all" }} scopeLabel="all alumni" />);
    await openHistory();
    expect(await screen.findByText(/needs access to every school/)).toBeInTheDocument();
  });
});
