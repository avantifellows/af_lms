import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

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
  mockRefresh.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DraftStatus", () => {
  it("shows drafting as a readable badge with its spinner inside", () => {
    render(<DraftStatus draftId={41} initialState="transcribing" />);
    const badge = screen.getByText("Drafting from the Call Recording").parentElement!;
    // `warning`, not the pale blue `info` text that was nearly unreadable.
    expect(badge).toHaveClass("text-warning-text");
    expect(badge).not.toHaveClass("text-info");
    expect(badge.querySelector(".animate-spin")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no spinner once the draft is ready or failed", () => {
    const { rerender, container } = render(<DraftStatus draftId={41} initialState="ready" />);
    expect(container.querySelector(".animate-spin")).toBeNull();
    rerender(<DraftStatus key="failed" draftId={41} initialState="failed" />);
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("frames the draft as a Card by default, and drops the Card when framed is false", () => {
    const { rerender } = render(<DraftStatus draftId={41} initialState="failed" />);
    const region = screen.getByRole("region", { name: "Conversation Draft" });
    expect(region.firstElementChild).toHaveClass("border", "shadow-sm");
    rerender(<DraftStatus draftId={41} initialState="failed" framed={false} />);
    expect(region.firstElementChild).not.toHaveClass("border");
    expect(region.firstElementChild).not.toHaveClass("shadow-sm");
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
  });

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

  it("polls at the given pace and calls onReady once the draft turns ready", async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    render(
      <DraftStatus draftId={41} initialState="transcribing" pollMs={5_000} onReady={onReady} drafting="Writing it up." />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Writing it up.");

    answer({ id: 41, state: "ready", retryOffered: false });
    await advance(5_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not call onReady for a draft that was already ready", () => {
    const onReady = vi.fn();
    render(<DraftStatus draftId={41} initialState="ready" onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
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

describe("DraftStatus retry and discard", () => {
  it("offers Retry and Discard on a failed draft; Retry asks again and polls the new drafting", async () => {
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage />);
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();

    answer({ id: 43, state: "transcribing", retryOffered: false, delivery: "sent" });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/drafts/43/retry", { method: "POST" });
    expect(await screen.findByText("Drafting from the Call Recording")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("offers Retry drafting on a transcribing draft whose wake never reached ETL", async () => {
    render(<DraftStatus draftId={41} initialState="transcribing" initialRetryOffered canManage />);

    answer({ id: 41, state: "transcribing", retryOffered: true, delivery: "skipped" });
    await userEvent.click(screen.getByRole("button", { name: "Retry drafting" }));

    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/drafts/41/retry", { method: "POST" });
    expect(await screen.findByText("Asked to draft it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry drafting" })).toBeInTheDocument();
  });

  it("offers only Discard on a ready draft, and on a transcribing draft ETL has picked up", () => {
    const { unmount } = render(<DraftStatus draftId={44} initialState="ready" canManage />);
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    unmount();

    render(<DraftStatus draftId={42} initialState="transcribing" canManage />);
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("shows Retry drafting once a poll reports the wake never reached ETL", async () => {
    vi.useFakeTimers();
    render(<DraftStatus draftId={41} initialState="transcribing" canManage />);
    expect(screen.queryByRole("button", { name: "Retry drafting" })).not.toBeInTheDocument();

    answer({ id: 41, state: "transcribing", retryOffered: true });
    await advance(15_000);
    expect(screen.getByRole("button", { name: "Retry drafting" })).toBeInTheDocument();
  });

  it("discards the draft after confirming, hides the panel and refreshes the page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage />);

    answer({ id: 43, state: "discarded" });
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/drafts/43/discard", { method: "POST" });
    expect(screen.queryByRole("region", { name: "Conversation Draft" })).not.toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("keeps the draft when the discard is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
  });

  it("shows the error and keeps the controls when the server refuses", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage />);

    answer({ error: "This draft can't be discarded now." }, 409);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This draft can't be discarded now.");
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows the same controls, disabled, to someone who can't manage drafts", () => {
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage={false} />);
    expect(screen.getByText("Drafting failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toHaveAttribute("title", "View only");
  });

  it("shows the server's unreadable refusal and a lost connection as errors", async () => {
    render(<DraftStatus draftId={43} initialState="failed" initialRetryOffered canManage />);

    mockFetch.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");

    mockFetch.mockRejectedValueOnce(new TypeError("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server. Try again.");
  });
});

describe("DraftStatus review link", () => {
  it("links a ready draft to its review for someone who can log, even without managing drafts", () => {
    render(<DraftStatus draftId={44} initialState="ready" reviewHref="/blended-learning/students/501/log?draft=44" />);
    expect(screen.getByRole("link", { name: "Review draft" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501/log?draft=44"
    );
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("shows a ready draft's Review draft disabled to someone who can't log", () => {
    render(<DraftStatus draftId={44} initialState="ready" reviewHref={null} />);
    expect(screen.queryByRole("link", { name: "Review draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review draft" })).toBeDisabled();
  });

  it("offers no review link until the draft is ready", () => {
    render(<DraftStatus draftId={42} initialState="transcribing" reviewHref="/blended-learning/students/501/log" />);
    expect(screen.queryByRole("link", { name: "Review draft" })).not.toBeInTheDocument();
  });
});
