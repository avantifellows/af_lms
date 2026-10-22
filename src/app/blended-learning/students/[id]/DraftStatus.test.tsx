import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStatus } from "./DraftStatus";

// The draft status route is the component's network boundary.
const mockFetch = vi.fn();

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DraftStatus", () => {
  it("polls a transcribing draft every 15 seconds and shows the new state once it is ready", async () => {
    vi.useFakeTimers();
    render(<DraftStatus draftId={41} initialState="transcribing" />);
    expect(screen.getByText("Drafting from the Call Recording")).toBeInTheDocument();

    answer({ id: 41, state: "transcribing", retryOffered: false });
    await advance(14_999);
    expect(mockFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/drafts/41", expect.anything());
    expect(screen.getByText("Drafting from the Call Recording")).toBeInTheDocument();

    answer({ id: 41, state: "ready", retryOffered: false });
    await advance(15_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Draft ready to review")).toBeInTheDocument();

    // Nothing changes a ready draft by itself, so polling stops.
    await advance(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("shows Drafting failed when the poll reports a failed draft", async () => {
    vi.useFakeTimers();
    render(<DraftStatus draftId={41} initialState="transcribing" />);

    answer({ id: 41, state: "failed", retryOffered: true });
    await advance(15_000);
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
  });

  it("keeps polling through a failed request", async () => {
    vi.useFakeTimers();
    render(<DraftStatus draftId={41} initialState="transcribing" />);

    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await advance(15_000);
    expect(screen.getByText("Drafting from the Call Recording")).toBeInTheDocument();

    answer({ id: 41, state: "ready", retryOffered: false });
    await advance(15_000);
    expect(screen.getByText("Draft ready to review")).toBeInTheDocument();
  });

  it("does not poll a draft that is already ready or failed", async () => {
    vi.useFakeTimers();
    render(<DraftStatus draftId={44} initialState="ready" />);
    expect(screen.getByText("Draft ready to review")).toBeInTheDocument();
    await advance(60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops polling when the page is closed", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<DraftStatus draftId={41} initialState="transcribing" />);
    unmount();
    await advance(60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
