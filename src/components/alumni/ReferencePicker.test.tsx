import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ReferencePicker from "./ReferencePicker";

const fetchMock = vi.fn();
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

async function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  // Searches run after a short pause in typing.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReferencePicker", () => {
  it("searches after two letters and stores the picked code", async () => {
    const onChange = vi.fn();
    fetchMock.mockResolvedValue(json({ results: [{ code: "U-0237", name: "NIT Karnataka Surathkal", meta: "Dakshina Kannada, Karnataka" }] }));
    render(<ReferencePicker kind="college" id="f-college" code="" name="" onChange={onChange} />);

    await type("n");
    expect(fetchMock).not.toHaveBeenCalled();

    await type("nit surathkal");
    expect(fetchMock).toHaveBeenCalledWith("/api/alumni/search/college?q=nit%20surathkal");
    fireEvent.click(screen.getByText("NIT Karnataka Surathkal"));
    expect(onChange).toHaveBeenCalledWith("U-0237", "NIT Karnataka Surathkal");
  });

  it("says when nothing matches, and shows search errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [] }));
    render(<ReferencePicker kind="branch" id="f-branch" code="" name="" onChange={vi.fn()} />);
    await type("zzz");
    expect(screen.getByText(/No branch matches/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(json({ error: "Search failed. Try again." }, false));
    await type("yyy");
    expect(screen.getByText("Search failed. Try again.")).toBeInTheDocument();
  });

  it("shows the chosen value and can clear it", () => {
    const onChange = vi.fn();
    render(<ReferencePicker kind="college" id="f-college" code="C-19609" name="Nalla Malla Reddy" onChange={onChange} />);
    expect(screen.getByText("Nalla Malla Reddy")).toBeInTheDocument();
    expect(screen.getByText("C-19609")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear college" }));
    expect(onChange).toHaveBeenCalledWith("", "");
  });
});
