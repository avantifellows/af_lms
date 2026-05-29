import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDocumentForm } from "./UploadDocumentForm";

// Mock the downscaler so tests don't depend on canvas / Image globals.
vi.mock("@/lib/image-resize", () => ({
  downscaleImage: vi.fn(async (file: File) =>
    new Blob([`downscaled:${file.name}`], { type: "image/jpeg" }),
  ),
}));

const FETCH_OK = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
      text: async () => "",
    };
  });

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom doesn't implement createObjectURL on blobs reliably — stub it.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFile(name: string, type: string, size = 100): File {
  // The constructor's BlobPart needs concrete bytes for size to be honored.
  const bytes = new Uint8Array(size);
  return new File([bytes as BlobPart], name, { type });
}

describe("UploadDocumentForm — mode toggle", () => {
  it("starts in photos mode and switches to pdf mode", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    expect(screen.getByRole("tab", { name: "Photos" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    expect(screen.getByRole("tab", { name: "PDF" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Photos" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: /select pdf/i })).toBeInTheDocument();
  });

  it("clears pending pages when switching modes", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    const photoInput = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;
    expect(photoInput).not.toBeNull();

    fireEvent.change(photoInput, { target: { files: [makeFile("a.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByAltText(/page 1 preview/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    expect(screen.queryByAltText(/page 1 preview/i)).not.toBeInTheDocument();
  });
});

describe("UploadDocumentForm — photos mode validation", () => {
  it("rejects unsupported image types", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("a.gif", "image/gif")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported image type/i);
  });

  it("rejects oversized images", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    const huge = makeFile("a.jpg", "image/jpeg", 11 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [huge] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("adds a page on a valid image and removes it on click", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("a.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByAltText(/page 1 preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove page 1/i }));
    expect(screen.queryByAltText(/page 1 preview/i)).not.toBeInTheDocument();
  });
});

describe("UploadDocumentForm — PDF mode validation", () => {
  it("rejects non-PDF files", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("a.jpg", "image/jpeg")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/must be a pdf/i);
  });

  it("rejects oversized PDFs (>5MB)", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("a.pdf", "application/pdf", 6 * 1024 * 1024)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("shows the selected PDF and clears it on remove", async () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("doc.pdf", "application/pdf", 1024)] } });
    expect(await screen.findByText("doc.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove pdf/i }));
    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /select pdf/i })).toBeInTheDocument();
  });
});

describe("UploadDocumentForm — submit", () => {
  it("submits photos as a multipart POST with sequential page_N fields", async () => {
    const fetchMock = FETCH_OK();
    vi.stubGlobal("fetch", fetchMock);
    const onUploaded = vi.fn();

    render(<UploadDocumentForm studentId={42} studentName="A" onUploaded={onUploaded} />);
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [makeFile("a.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByAltText(/page 1 preview/i)).toBeInTheDocument());
    fireEvent.change(input, { target: { files: [makeFile("b.png", "image/png")] } });
    await waitFor(() => expect(screen.getByAltText(/page 2 preview/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /upload 2 pages/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    const url = call[0];
    const init = call[1] as RequestInit;
    expect(url).toBe("/api/students/42/documents");
    expect(init.method).toBe("POST");

    const fd = init.body as FormData;
    expect(fd.get("document_type")).toBe("student_undertaking");
    expect(fd.get("page_1")).toBeTruthy();
    expect(fd.get("page_2")).toBeTruthy();
    expect(fd.get("page_3")).toBeNull();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("submits a PDF as page_1", async () => {
    const fetchMock = FETCH_OK();
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadDocumentForm studentId={7} studentName="A" />);
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("doc.pdf", "application/pdf", 1024)] } });

    await waitFor(() => expect(screen.getByText("doc.pdf")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /upload pdf/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    const fd = (call[1] as RequestInit).body as FormData;
    const page1 = fd.get("page_1") as File;
    expect(page1).toBeTruthy();
    expect(page1.name).toBe("doc.pdf");
    expect(page1.type).toBe("application/pdf");
  });

  it("surfaces server errors and keeps the form populated", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "S3 hiccup" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadDocumentForm studentId={1} studentName="A" />);
    const input = screen.getByLabelText(/upload document/i).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("a.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByAltText(/page 1 preview/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /upload 1 page/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/s3 hiccup/i);
    // Form retains the page
    expect(screen.getByAltText(/page 1 preview/i)).toBeInTheDocument();
  });

  it("disables submit until something is selected", () => {
    render(<UploadDocumentForm studentId={1} studentName="A" />);
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
  });
});
