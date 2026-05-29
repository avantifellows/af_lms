import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentCard } from "./DocumentCard";
import type { LmsStudentDocumentRow } from "@/lib/db-service-documents";

function makeDoc(overrides: Partial<LmsStudentDocumentRow> = {}): LmsStudentDocumentRow {
  return {
    id: 1,
    student_id: 42,
    document_type: "wise_research_consent",
    pages: [
      { s3_key: "k1", page_number: 1, mime_type: "image/jpeg", byte_size: 100 },
      { s3_key: "k2", page_number: 2, mime_type: "image/jpeg", byte_size: 100 },
    ],
    metadata: {},
    uploaded_by: "teacher@avantifellows.org",
    deleted_at: null,
    inserted_at: "2026-05-29T10:00:00Z",
    updated_at: "2026-05-29T10:00:00Z",
    ...overrides,
  };
}

describe("DocumentCard", () => {
  it("renders the document type label, page count, uploader, and date", () => {
    render(<DocumentCard doc={makeDoc()} />);
    expect(screen.getByText("WISE Research Consent")).toBeInTheDocument();
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    expect(screen.getByText(/teacher@avantifellows\.org/)).toBeInTheDocument();
    expect(screen.getByText(/29 May 2026/)).toBeInTheDocument();
  });

  it("shows '1 page' for a single-image doc", () => {
    const doc = makeDoc({
      pages: [{ s3_key: "k", page_number: 1, mime_type: "image/jpeg", byte_size: 100 }],
    });
    render(<DocumentCard doc={doc} />);
    expect(screen.getByText("1 page")).toBeInTheDocument();
  });

  it("shows a PDF badge for application/pdf docs", () => {
    const doc = makeDoc({
      pages: [{ s3_key: "k", page_number: 1, mime_type: "application/pdf", byte_size: 100 }],
    });
    render(<DocumentCard doc={doc} />);
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("renders the raw document_type string when not in the allowlist", () => {
    const doc = makeDoc({ document_type: "legacy_type" });
    render(<DocumentCard doc={doc} />);
    expect(screen.getByText("legacy_type")).toBeInTheDocument();
  });

  it("calls onDelete with the doc id when the delete button is clicked", async () => {
    const onDelete = vi.fn(async () => {});
    render(<DocumentCard doc={makeDoc({ id: 77 })} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: /delete wise research consent/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(77));
  });

  it("hides the delete button when canDelete is false", () => {
    const onDelete = vi.fn();
    render(<DocumentCard doc={makeDoc()} onDelete={onDelete} canDelete={false} />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("hides the delete button when no onDelete is provided", () => {
    render(<DocumentCard doc={makeDoc()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("surfaces an error message when onDelete throws", async () => {
    const onDelete = vi.fn(async () => {
      throw new Error("boom");
    });
    render(<DocumentCard doc={makeDoc()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete/i);
  });

  it("renders a single 'Open' link for a 1-page doc", () => {
    const doc = makeDoc({
      id: 99,
      student_id: 313961,
      pages: [{ s3_key: "k", page_number: 1, mime_type: "image/jpeg", byte_size: 100 }],
    });
    render(<DocumentCard doc={doc} />);
    const link = screen.getByRole("link", { name: /open/i });
    expect(link).toHaveAttribute("href", "/api/students/313961/documents/99/page/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders a numbered link per page for a multi-page doc", () => {
    const doc = makeDoc({
      id: 7,
      student_id: 42,
      pages: [
        { s3_key: "k1", page_number: 1, mime_type: "image/jpeg", byte_size: 100 },
        { s3_key: "k2", page_number: 2, mime_type: "image/jpeg", byte_size: 100 },
        { s3_key: "k3", page_number: 3, mime_type: "image/jpeg", byte_size: 100 },
      ],
    });
    render(<DocumentCard doc={doc} />);
    const links = screen.getAllByRole("link", { name: /open page/i });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/api/students/42/documents/7/page/1");
    expect(links[1]).toHaveAttribute("href", "/api/students/42/documents/7/page/2");
    expect(links[2]).toHaveAttribute("href", "/api/students/42/documents/7/page/3");
  });

  it("uses the page's actual page_number (not the array index) in the URL", () => {
    const doc = makeDoc({
      id: 1,
      student_id: 1,
      // Imagine a sparse legacy doc — only page 1 + page 4. We should still link to 4.
      pages: [
        { s3_key: "k1", page_number: 1, mime_type: "image/jpeg", byte_size: 100 },
        { s3_key: "k4", page_number: 4, mime_type: "image/jpeg", byte_size: 100 },
      ],
    });
    render(<DocumentCard doc={doc} />);
    const links = screen.getAllByRole("link");
    expect(links[1]).toHaveAttribute("href", "/api/students/1/documents/1/page/4");
  });
});
