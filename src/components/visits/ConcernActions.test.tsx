import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { ConcernActions } from "./ConcernActions";

function respondWith(response: { ok: boolean; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({}), ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0];
  return { url, method: init.method, body: JSON.parse(init.body) };
}

beforeEach(() => {
  mockRefresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConcernActions", () => {
  it("offers only Resolve on an open concern", () => {
    render(<ConcernActions concernId={9004801} status="open" />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Resolve"]);
  });

  it("offers Comment and Reopen on a resolved concern", () => {
    render(<ConcernActions concernId={9004801} status="resolved" />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Comment", "Reopen"]);
  });

  it("puts the buttons beside the card body, and opens the note form below it in their place", async () => {
    const user = userEvent.setup();
    render(
      <ConcernActions concernId={9004801} status="open">
        <p>Lab equipment missing</p>
      </ConcernActions>
    );

    expect(screen.getByText("Lab equipment missing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    expect(screen.getByText("Lab equipment missing")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "How was this resolved?" })).toHaveAttribute(
      "placeholder",
      "How was this resolved? (required)"
    );
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Mark resolved", "Cancel"]);
  });

  it("asks why a resolved concern is being reopened", async () => {
    const user = userEvent.setup();
    render(<ConcernActions concernId={9004801} status="resolved" />);

    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(screen.getByRole("textbox", { name: "Why is this being reopened?" })).toHaveAttribute(
      "placeholder",
      "Why is this being reopened? (required)"
    );
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Reopen", "Cancel"]);
  });

  it("resolves with the trimmed note and refreshes the page", async () => {
    const user = userEvent.setup();
    const fetchMock = respondWith({ ok: true });
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox", { name: "How was this resolved?" }), "  Lab kits delivered  ");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({
      url: "/api/visit-concerns/9004801/events",
      method: "POST",
      body: { action: "resolve", body: "Lab kits delivered" },
    });
    // The form closes and the action buttons come back.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it.each([
    ["Comment", "Comment", "Add comment", "comment"],
    ["Reopen", "Why is this being reopened?", "Reopen", "reopen"],
  ])("sends %s on a resolved concern", async (button, prompt, submit, action) => {
    const user = userEvent.setup();
    const fetchMock = respondWith({ ok: true });
    render(<ConcernActions concernId={7} status="resolved" />);

    await user.click(screen.getByRole("button", { name: button }));
    await user.type(screen.getByRole("textbox", { name: prompt }), "Checked again");
    await user.click(screen.getByRole("button", { name: submit }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(sentBody(fetchMock).body).toEqual({ action, body: "Checked again" });
  });

  it("refuses a whitespace-only note without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = respondWith({ ok: true });
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox"), "   ");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Please write a note");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a note over 2000 characters without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = respondWith({ ok: true });
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    const textbox = screen.getByRole("textbox");
    await user.click(textbox);
    await user.paste("a".repeat(2001));
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Note must be at most 2000 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows Saving… and disables the form while the request is in flight", async () => {
    const user = userEvent.setup();
    let finish: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox"), "Fixed");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();

    finish({ ok: true, json: () => Promise.resolve({}) });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the API's error and keeps the typed text when the save fails", async () => {
    const user = userEvent.setup();
    respondWith({ ok: false, json: () => Promise.resolve({ error: "This concern is already resolved" }) });
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox"), "Lab kits delivered");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This concern is already resolved");
    expect(screen.getByRole("textbox")).toHaveValue("Lab kits delivered");
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeEnabled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when the failed response has no JSON error", async () => {
    const user = userEvent.setup();
    respondWith({ ok: false, json: () => Promise.reject(new Error("not json")) });
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox"), "Fixed");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("says the server could not be reached when the request itself fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<ConcernActions concernId={9004801} status="open" />);

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.type(screen.getByRole("textbox"), "Fixed");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Please try again.");
    expect(screen.getByRole("textbox")).toHaveValue("Fixed");
  });

  it("Cancel closes the form and clears the typed text", async () => {
    const user = userEvent.setup();
    render(<ConcernActions concernId={9004801} status="resolved" />);

    await user.click(screen.getByRole("button", { name: "Comment" }));
    await user.type(screen.getByRole("textbox"), "Draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("tells the card which form opened, so it can expand", async () => {
    const onOpen = vi.fn();
    const { unmount } = render(<ConcernActions concernId={41} status="open" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onOpen).toHaveBeenCalledWith("resolve");
    unmount();

    render(<ConcernActions concernId={42} status="resolved" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onOpen).toHaveBeenLastCalledWith("reopen");
  });
});
