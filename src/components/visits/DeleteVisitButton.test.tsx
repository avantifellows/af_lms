import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DeleteVisitButton from "./DeleteVisitButton";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

describe("DeleteVisitButton", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    vi.unstubAllGlobals();
  });

  it("opens a confirmation modal with required copy", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn() as unknown as typeof fetch);

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));

    expect(screen.getByRole("dialog", { name: "Delete Visit" })).toBeInTheDocument();
    expect(
      screen.getByText("This visit and all its action points will be removed. This cannot be undone.")
    ).toBeInTheDocument();
  });

  it("cancel closes modal without calling fetch", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes and redirects to visits in detail mode", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10", {
      method: "DELETE",
    });
    expect(mockPush).toHaveBeenCalledWith("/visits");
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes and refreshes in list mode", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<DeleteVisitButton visitId={22} mode="list" />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Visit" })).getByRole("button", { name: "Delete" })
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/22", {
      method: "DELETE",
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows loading state and disables modal buttons while deleting", async () => {
    const user = userEvent.setup();
    let resolveDelete!: (value: { ok: boolean; json: () => Promise<{ success: boolean }> }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDelete = resolve;
          })
      ) as unknown as typeof fetch
    );

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolveDelete({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    await screen.findByRole("button", { name: "Delete Visit" });
  });

  it("shows API error message for a 409 response", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: "Completed visits cannot be deleted" }),
        })
      ) as unknown as typeof fetch
    );

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Completed visits cannot be deleted")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete Visit" })).toBeInTheDocument();
  });

  it("shows generic error when fetch throws", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Network is down"))) as unknown as typeof fetch
    );

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Failed to delete visit")).toBeInTheDocument();
    expect(screen.queryByText("Network is down")).not.toBeInTheDocument();
  });

  it("shows generic error for non-JSON failure responses", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error("not json")),
        })
      ) as unknown as typeof fetch
    );

    render(<DeleteVisitButton visitId={10} mode="detail" />);

    await user.click(screen.getByRole("button", { name: "Delete Visit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Failed to delete visit")).toBeInTheDocument();
  });
});
