import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HistoryPanel, { type JourneyEntry } from "./AlumniHistory";

const entry = (overrides: Partial<JourneyEntry>): JourneyEntry => ({
  id: "1",
  reportedOn: "2026-11-15",
  recordedAt: "2026-11-15T05:00:00Z",
  source: "call",
  recordedBy: "a@avantifellows.org",
  notes: "",
  changes: [],
  matchesCurrent: false,
  values: {},
  names: {},
  ...overrides,
});

const ENTRIES = [
  entry({ id: "7", source: "bulk_upload", changes: [{ column: "current_ctc", label: "Current CTC", before: "4.5", after: "45" }], matchesCurrent: true }),
  entry({ id: "3", reportedOn: "2026-06-10", recordedAt: "2026-11-12T05:00:00Z", notes: "Wrong Phone number" }),
  entry({ id: "1", reportedOn: "2025-12-01", source: "initial", recordedBy: "Automatic" }),
];

beforeEach(() => {
  document.body.style.paddingRight = "";
});
afterEach(() => vi.unstubAllGlobals());

const renderPanel = (selectedId: string | null = null, onSelect = vi.fn(), onClose = vi.fn()) =>
  render(<HistoryPanel journey={{ entries: ENTRIES, error: "" }} selectedId={selectedId} onSelect={onSelect} onClose={onClose} />);

describe("HistoryPanel", () => {
  it("lists every version, newest first, with what changed, the remark and late logging", () => {
    renderPanel();
    const items = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Close version history");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Bulk edit");
    expect(items[0]).toHaveTextContent("Current");
    expect(items[0]).toHaveTextContent("Changed: Current CTC");
    expect(items[1]).toHaveTextContent("“Wrong Phone number”");
    expect(items[1]).toHaveTextContent("logged 12 Nov 2026");
    expect(items[2]).toHaveTextContent("The record as it was first saved");
  });

  it("marks the version shown; the current one when none is picked", () => {
    const { rerender } = renderPanel(null);
    expect(screen.getByText("Bulk edit").closest("button")).toHaveAttribute("aria-current", "true");
    rerender(<HistoryPanel journey={{ entries: ENTRIES, error: "" }} selectedId="3" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("“Wrong Phone number”").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("picking an older version selects it; picking the latest goes back to the current record", () => {
    const onSelect = vi.fn();
    renderPanel("3", onSelect);
    fireEvent.click(screen.getByText("Starting record").closest("button")!);
    expect(onSelect).toHaveBeenLastCalledWith(ENTRIES[2]);
    fireEvent.click(screen.getByText("Current").closest("button")!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("closes, and gives the page its room back", () => {
    // jsdom has no matchMedia: a wide screen.
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const onClose = vi.fn();
    const { unmount } = renderPanel(null, vi.fn(), onClose);
    expect(document.body.style.paddingRight).toBe("24rem");
    fireEvent.click(screen.getByRole("button", { name: "Close version history" }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.body.style.paddingRight).toBe("");
  });

  it("says when there is no history yet", () => {
    render(<HistoryPanel journey={{ entries: [], error: "" }} selectedId={null} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No history yet/)).toBeInTheDocument();
  });
});
