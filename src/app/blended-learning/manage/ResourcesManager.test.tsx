import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { ResourcesManager } from "./ResourcesManager";

const mockFetch = vi.fn();

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status })
  );
}

function sent(call = 0) {
  const [url, init] = mockFetch.mock.calls[call];
  return { url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined };
}

const RESOURCES = [
  { id: 1, title: "Mentor Toolkit", url: "https://docs.google.com/document/d/toolkit" },
  { id: 2, title: "Exam stress guide", url: "https://example.org/stress" },
];

beforeEach(() => {
  mockFetch.mockReset();
  mockRefresh.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResourcesManager", () => {
  it("lists the Resources in order with their move ends disabled", () => {
    render(<ResourcesManager resources={RESOURCES} />);

    const list = screen.getByRole("list", { name: "Resources" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Mentor Toolkit (opens in a new tab)" })).toHaveAttribute(
      "href",
      RESOURCES[0].url
    );
    expect(screen.getByRole("button", { name: "Move Mentor Toolkit up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Exam stress guide down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Exam stress guide up" })).toBeEnabled();
  });

  it("says so when there are none", () => {
    render(<ResourcesManager resources={[]} />);
    expect(screen.getByText("No resources yet.")).toBeInTheDocument();
  });

  it("adds a Resource, then clears the form and refreshes", async () => {
    const user = userEvent.setup();
    answer({ id: 3, title: "Guide", url: "https://example.org/guide" }, 201);
    render(<ResourcesManager resources={RESOURCES} />);

    const form = screen.getByRole("form", { name: "Add a resource" });
    await user.type(within(form).getByLabelText("Title"), "Guide");
    await user.type(within(form).getByLabelText("Link"), "https://example.org/guide");
    await user.click(within(form).getByRole("button", { name: "Add resource" }));

    expect(sent()).toEqual({
      url: "/api/blended-learning/resources",
      method: "POST",
      body: { title: "Guide", url: "https://example.org/guide" },
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(within(form).getByLabelText("Title")).toHaveValue("");
  });

  it("shows the server's field errors inline", async () => {
    const user = userEvent.setup();
    answer({ error: "Enter a title.", fieldErrors: { title: "Enter a title.", url: "Enter a full link starting with https://" } }, 422);
    render(<ResourcesManager resources={RESOURCES} />);

    const form = screen.getByRole("form", { name: "Add a resource" });
    await user.click(within(form).getByRole("button", { name: "Add resource" }));

    expect(within(form).getByText("Enter a title.")).toBeInTheDocument();
    expect(within(form).getByText("Enter a full link starting with https://")).toBeInTheDocument();
    expect(within(form).getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a non-field error under the form", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ResourcesManager resources={RESOURCES} />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));

    expect(screen.getByText("Couldn't reach the server. Try again.")).toBeInTheDocument();
  });

  it("edits a Resource in place, and cancel leaves it", async () => {
    const user = userEvent.setup();
    answer({ id: 2, title: "Stress guide", url: "https://example.org/stress" });
    render(<ResourcesManager resources={RESOURCES} />);

    await user.click(screen.getByRole("button", { name: "Edit Exam stress guide" }));
    const form = screen.getByRole("form", { name: "Edit Exam stress guide" });
    await user.clear(within(form).getByLabelText("Title"));
    await user.type(within(form).getByLabelText("Title"), "Stress guide");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(sent()).toEqual({
      url: "/api/blended-learning/resources/2",
      method: "PATCH",
      body: { title: "Stress guide", url: "https://example.org/stress" },
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit Exam stress guide" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Mentor Toolkit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit Mentor Toolkit" })).not.toBeInTheDocument();
  });

  it("moves a Resource and shows a failed move's error", async () => {
    const user = userEvent.setup();
    answer({ ok: true });
    answer({ error: "Not found" }, 404);
    render(<ResourcesManager resources={RESOURCES} />);

    await user.click(screen.getByRole("button", { name: "Move Exam stress guide up" }));
    expect(sent()).toEqual({ url: "/api/blended-learning/resources/2/move", method: "POST", body: { direction: "up" } });
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Move Mentor Toolkit down" }));
    expect(sent(1).body).toEqual({ direction: "down" });
    expect(screen.getByRole("alert")).toHaveTextContent("Not found");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("removes a Resource only after confirming", async () => {
    const user = userEvent.setup();
    answer({ error: "Not found" }, 404);
    answer(null, 204);
    render(<ResourcesManager resources={RESOURCES} />);

    await user.click(screen.getByRole("button", { name: "Remove Exam stress guide" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this resource?" });
    expect(dialog).toHaveTextContent("Exam stress guide will no longer show on the Resources tab.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove Exam stress guide" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Not found");

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(sent(1)).toEqual({ url: "/api/blended-learning/resources/2", method: "DELETE", body: undefined });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
