import { render, screen } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { LegacyActionItems } from "./LegacyActionItems";

// Synthetic items only.
const OPTICS = { index: 0, text: "Synthetic: revise optics", owner: "student" as const, doneAt: null, doneByEmail: null };
const FEE = {
  index: 2, text: "Synthetic: pay the hostel fee", owner: "parent" as const,
  doneAt: "2026-10-21T10:00:00+05:30", doneByEmail: "m@test.local",
};

const mockFetch = vi.fn();
let userEvent: ReturnType<typeof userEventLib.setup>;

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function renderList(props: Partial<Parameters<typeof LegacyActionItems>[0]> = {}) {
  return render(
    <LegacyActionItems studentId={501} initialItems={[OPTICS, FEE]} canTick superseded={false} {...props} />
  );
}

function box(text: string) {
  return screen.getByRole("checkbox", { name: `Done: ${text}` });
}

beforeEach(() => {
  userEvent = userEventLib.setup({ delay: null });
  mockFetch.mockReset();
  mockRefresh.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LegacyActionItems", () => {
  it("shows done items struck through with when and by whom", () => {
    renderList();
    expect(box(OPTICS.text)).not.toBeChecked();
    expect(box(FEE.text)).toBeChecked();
    expect(screen.getByText(FEE.text)).toHaveClass("line-through");
    expect(screen.getByText("Done · 21 Oct 2026 · m@test.local")).toBeInTheDocument();
  });

  it("ticks an item at once and saves it with the text and owner seen", async () => {
    let resolve: (value: Response) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    renderList();

    await userEvent.click(box(OPTICS.text));
    // Optimistic, and not clickable again until saved.
    expect(box(OPTICS.text)).toBeChecked();
    expect(box(OPTICS.text)).toBeDisabled();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/blended-learning/students/501/legacy-action-items");
    expect(JSON.parse(String(init.body))).toEqual({ index: 0, text: OPTICS.text, owner: "student", done: true });

    resolve(new Response(JSON.stringify({ item: { ...OPTICS, doneAt: "2026-10-27T09:00:00+05:30", doneByEmail: "me@test.local" } })));
    expect(await screen.findByText("Done · 27 Oct 2026 · me@test.local")).toBeInTheDocument();
    expect(box(OPTICS.text)).toBeEnabled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("unticks a done item", async () => {
    answer({ item: { ...FEE, doneAt: null, doneByEmail: null } });
    renderList();
    await userEvent.click(box(FEE.text));
    expect(box(FEE.text)).not.toBeChecked();
    expect(JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ index: 2, done: false });
    expect(screen.queryByText(/^Done ·/)).not.toBeInTheDocument();
  });

  it("puts the box back and says why when the save fails", async () => {
    answer({ error: "These Profile Doc items have changed. Reload the page." }, 409);
    renderList();
    await userEvent.click(box(OPTICS.text));
    expect(await screen.findByTestId("legacy-item-error")).toHaveTextContent("These Profile Doc items have changed. Reload the page.");
    expect(box(OPTICS.text)).not.toBeChecked();

    mockFetch.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(box(FEE.text));
    expect(await screen.findByTestId("legacy-item-error")).toHaveTextContent("Check your connection");
    expect(box(FEE.text)).toBeChecked();

    mockFetch.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    await userEvent.click(box(FEE.text));
    expect(await screen.findByTestId("legacy-item-error")).toHaveTextContent("Couldn't save. Try again.");
  });

  it("refreshes the page once the last open item is ticked after a Conversation in the app", async () => {
    answer({ item: { ...OPTICS, doneAt: "2026-10-27T09:00:00+05:30", doneByEmail: "me@test.local" } });
    renderList({ superseded: true });
    await userEvent.click(box(OPTICS.text));
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it("disables every box for someone who may not tick", () => {
    renderList({ canTick: false });
    expect(box(OPTICS.text)).toBeDisabled();
    expect(box(FEE.text)).toBeDisabled();
  });
});
