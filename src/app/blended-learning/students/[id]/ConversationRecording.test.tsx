import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationRecording } from "./ConversationRecording";

// The recording and transcript routes are the component's network boundary.
const mockFetch = vi.fn();

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function pending() {
  let resolve!: (res: Response) => void;
  mockFetch.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
  return (body: unknown) => resolve(new Response(JSON.stringify(body)));
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConversationRecording", () => {
  it("plays the recording from a presigned URL on demand", async () => {
    const user = userEvent.setup();
    const finish = pending();
    render(<ConversationRecording conversationId={12} hasRecording hasTranscript={false} />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Show transcript" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play recording" }));
    expect(screen.getByRole("button", { name: "Loading recording…" })).toBeDisabled();
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/conversations/12/recording");

    await act(async () => finish({ expired: false, url: "https://s3.example/recording.mp3?signed" }));

    const region = screen.getByRole("region", { name: "Call Recording" });
    expect(region.querySelector("audio")).toHaveAttribute("src", "https://s3.example/recording.mp3?signed");
    expect(screen.queryByRole("button", { name: /recording/ })).not.toBeInTheDocument();
  });

  it("says the recording expired when S3 no longer holds it", async () => {
    const user = userEvent.setup();
    answer({ expired: true });
    render(<ConversationRecording conversationId={12} hasRecording hasTranscript={false} />);

    await user.click(screen.getByRole("button", { name: "Play recording" }));

    expect(await screen.findByText("Recording expired")).toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("offers Play again after the recording fails to load", async () => {
    const user = userEvent.setup();
    answer({ error: "Forbidden" }, 403);
    render(<ConversationRecording conversationId={12} hasRecording hasTranscript={false} />);

    await user.click(screen.getByRole("button", { name: "Play recording" }));

    expect(await screen.findByText("Couldn't load the recording. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play recording" })).toBeEnabled();

    answer({ expired: true });
    await user.click(screen.getByRole("button", { name: "Play recording" }));
    expect(await screen.findByText("Recording expired")).toBeInTheDocument();
  });

  it("loads the transcript on first expand as speaker turns, and keeps it", async () => {
    const user = userEvent.setup();
    const finish = pending();
    render(<ConversationRecording conversationId={12} hasRecording={false} hasTranscript />);
    expect(screen.queryByRole("button", { name: "Play recording" })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Show transcript" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "conversation-12-transcript");
    await user.click(toggle);
    expect(screen.getByText("Loading transcript…")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/conversations/12/transcript");

    // Collapsing and expanding while it loads does not fetch it twice.
    await user.click(screen.getByRole("button", { name: "Hide transcript" }));
    await user.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () =>
      finish({
        expired: false,
        turns: [
          { speaker: "Speaker 1", text: "How was the mock test?" },
          { speaker: null, text: "Unlabelled words" },
        ],
      })
    );

    const turns = await screen.findByRole("list", { name: "Transcript" });
    const items = within(turns).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Speaker 1How was the mock test?");
    expect(items[1]).toHaveTextContent("Unlabelled words");
    expect(within(items[1]).queryByText(/Speaker/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide transcript" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Hide transcript" }));
    expect(screen.queryByRole("list", { name: "Transcript" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(screen.getByRole("list", { name: "Transcript" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("says the transcript expired when S3 no longer holds it", async () => {
    const user = userEvent.setup();
    answer({ expired: true });
    render(<ConversationRecording conversationId={12} hasRecording={false} hasTranscript />);

    await user.click(screen.getByRole("button", { name: "Show transcript" }));

    expect(await screen.findByText("Transcript expired")).toBeInTheDocument();
  });

  it("refetches the transcript after a failed load", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ConversationRecording conversationId={12} hasRecording hasTranscript />);

    await user.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(await screen.findByText("Couldn't load the transcript. Try again.")).toBeInTheDocument();

    answer({ expired: false, turns: [{ speaker: "Speaker 1", text: "Hello" }] });
    await user.click(screen.getByRole("button", { name: "Hide transcript" }));
    await user.click(screen.getByRole("button", { name: "Show transcript" }));

    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // The recording still waits for its own click.
    expect(screen.getByRole("button", { name: "Play recording" })).toBeInTheDocument();
  });
});
