import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FindAlumnus from "./FindAlumnus";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const type = (q: string) => fireEvent.change(screen.getByLabelText("Find an alumnus"), { target: { value: q } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FindAlumnus", () => {
  it("waits for 2 characters, then lists matches linking to their record", async () => {
    fetchMock.mockResolvedValue(json({
      results: [
        { alumniId: "8340", afid: "2632401171", name: "Asha Rao", cohortYear: "2019-2020", schoolCode: "59525", schoolName: "JNV Adilabad" },
        { alumniId: "9", afid: "", name: "Asha K", cohortYear: "", schoolCode: "", schoolName: "" },
      ],
    }));
    render(<FindAlumnus />);
    type("a");
    expect(fetchMock).not.toHaveBeenCalled();

    type("asha");
    const link = await screen.findByRole("link", { name: /Asha Rao/ });
    expect(link).toHaveAttribute("href", "/alumni/record/8340");
    expect(link).toHaveTextContent("JNV Adilabad · cohort 2019-2020");
    expect(screen.getByRole("link", { name: /Asha K/ })).toHaveTextContent("No school on record");
    expect(fetchMock).toHaveBeenCalledWith("/api/alumni/find?q=asha");
  });

  it("says when nothing matched, and when the search failed", async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [] }));
    render(<FindAlumnus />);
    type("zz");
    expect(await screen.findByText("No alumni found.")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(json({ error: "Access denied" }, 403));
    type("zzz");
    expect(await screen.findByText("Access denied")).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    type("zzzz");
    await waitFor(() => expect(screen.getByText(/Check your connection/)).toBeInTheDocument());
  });
});
