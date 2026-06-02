import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DocumentsList } from "./DocumentsList";

function mockFetchSequence(
  responses: Array<{ ok: boolean; status: number; body?: unknown }>,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    const r = responses.shift();
    if (!r) throw new Error("Unexpected extra fetch call");
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
      text: async () => "",
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleDocs = [
  {
    id: 1,
    student_id: 42,
    document_type: "wise_research_consent",
    pages: [{ s3_key: "k", page_number: 1, mime_type: "image/jpeg", byte_size: 100 }],
    metadata: {},
    uploaded_by: "a@af.org",
    deleted_at: null,
    inserted_at: "2026-05-29T10:00:00Z",
    updated_at: "2026-05-29T10:00:00Z",
  },
  {
    id: 2,
    student_id: 42,
    document_type: "income_certificate",
    pages: [{ s3_key: "k2", page_number: 1, mime_type: "application/pdf", byte_size: 100 }],
    metadata: {},
    uploaded_by: "b@af.org",
    deleted_at: null,
    inserted_at: "2026-05-30T10:00:00Z",
    updated_at: "2026-05-30T10:00:00Z",
  },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentsList", () => {
  it("shows a loading state then renders fetched docs newest-first", async () => {
    mockFetchSequence([{ ok: true, status: 200, body: sampleDocs }]);
    render(<DocumentsList studentId={42} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => expect(screen.getByLabelText(/documents list/i)).toBeInTheDocument());
    const cards = screen.getAllByText(/Income Certificate|WISE Research Consent/);
    // Newest first → income_certificate (2026-05-30) before wise_research_consent (2026-05-29)
    expect(cards[0]).toHaveTextContent("Income Certificate");
    expect(cards[1]).toHaveTextContent("WISE Research Consent");
  });

  it("renders an empty state when no docs", async () => {
    mockFetchSequence([{ ok: true, status: 200, body: [] }]);
    render(<DocumentsList studentId={42} />);
    await waitFor(() => expect(screen.getByText(/no documents uploaded/i)).toBeInTheDocument());
  });

  it("shows an error when fetch fails (non-2xx)", async () => {
    mockFetchSequence([{ ok: false, status: 502, body: { error: "down" } }]);
    render(<DocumentsList studentId={42} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/failed to load/i));
  });

  it("refetches when refreshNonce changes", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, status: 200, body: [] },
      { ok: true, status: 200, body: sampleDocs },
    ]);
    const { rerender } = render(<DocumentsList studentId={42} refreshNonce={1} />);
    await waitFor(() => expect(screen.getByText(/no documents/i)).toBeInTheDocument());

    rerender(<DocumentsList studentId={42} refreshNonce={2} />);
    await waitFor(() => expect(screen.getByLabelText(/documents list/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes a document via DELETE and refetches", async () => {
    // URL/method-aware mock so React's dev-mode double-effects (which fire
    // the GET twice on mount) don't desync a fixed response sequence.
    let currentDocs = [...sampleDocs];
    const deleteCalls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        deleteCalls.push({ url, method });
        const id = Number(url.split("/").pop());
        currentDocs = currentDocs.filter((d) => d.id !== id);
        return {
          ok: true,
          status: 204,
          json: async (): Promise<unknown> => null,
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => currentDocs,
        text: async (): Promise<string> => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsList studentId={42} />);

    await waitFor(() => expect(screen.getByText("Income Certificate")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete income certificate/i }));

    await waitFor(() =>
      expect(deleteCalls).toEqual([
        { url: "/api/students/42/documents/2", method: "DELETE" },
      ]),
    );
    await waitFor(() => expect(screen.queryByText("Income Certificate")).not.toBeInTheDocument());
    expect(screen.getByText("WISE Research Consent")).toBeInTheDocument();
  });

  it("hides delete buttons when canDelete=false", async () => {
    mockFetchSequence([{ ok: true, status: 200, body: sampleDocs }]);
    render(<DocumentsList studentId={42} canDelete={false} />);
    await waitFor(() => expect(screen.getByLabelText(/documents list/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
