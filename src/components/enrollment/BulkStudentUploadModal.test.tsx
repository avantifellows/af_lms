import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BulkStudentUploadModal from "./BulkStudentUploadModal";

const baseProps = {
  open: true,
  schoolUdise: "12345678901",
  schoolCode: "JNV001",
  onClose: vi.fn(),
  onUploaded: vi.fn(),
};

describe("BulkStudentUploadModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("downloads the template, uploads xlsx/csv files, and exposes rejected rows as csv", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 2, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 1 },
          ignored_rows: [
            {
              row_number: 7,
              matched_fields: ["Student Name", "PEN"],
              message: "Row 7 was ignored as the example row. Matched: Student Name, PEN.",
            },
          ],
          results: [
            {
              row_number: 2,
              status: "created",
              generated_student_id: "202712345678",
              original: { "Student Name": "Created Student", Grade: "12" },
            },
            {
              row_number: 3,
              status: "rejected",
              original: { "Student Name": "Bad Student", Grade: "11" },
              field_errors: { stream: "Primary Exam preparing for is not valid" },
              row_errors: ["PEN or Grade 10 Roll no is required"],
              existing_match: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    expect(screen.getByRole("link", { name: "Download template" })).toHaveAttribute(
      "href",
      "/api/school/12345678901/students",
    );
    expect(screen.getByText(/Each row supplies Grade 11 or 12/)).toHaveTextContent(
      "PEN or Grade 10 Roll no is required",
    );

    expect(screen.queryByLabelText("Upload grade")).not.toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Student upload file"),
      new File(["fake"], "students.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Upload students" }));

    await waitFor(() => expect(baseProps.onUploaded).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/school/12345678901/students",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    const form = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(Array.from(form.keys())).toEqual(["file"]);
    expect(screen.getByText("1 done, 1 to go")).toBeInTheDocument();
    expect(
      screen.getByText("Row 7 was ignored as the example row. Matched: Student Name, PEN."),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Grade" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Bad Student")).toBeInTheDocument();
    expect(screen.getByText(
      "Primary Exam preparing for is not valid; PEN or Grade 10 Roll no is required",
    )).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download rejected rows CSV" })).toHaveAttribute(
      "href",
      expect.stringContaining("data:text/csv"),
    );
  });

  it("shows a clear error when the upload contains only example rows", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "No students to upload. Row 2 was ignored as the example row. Matched: PEN. Add at least one student and upload again.",
          ignored_rows: [
            {
              row_number: 2,
              matched_fields: ["PEN"],
              message: "Row 2 was ignored as the example row. Matched: PEN.",
            },
          ],
        }),
        { status: 400 },
      ),
    );

    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await user.upload(
      screen.getByLabelText("Student upload file"),
      new File(["fake"], "students.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload students" }));

    expect(
      await screen.findByText(/No students to upload.*Add at least one student/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Row 2 was ignored as the example row. Matched: PEN."),
    ).toBeInTheDocument();
    expect(baseProps.onUploaded).not.toHaveBeenCalled();
  });

  it("counts every uncreated row as to go and includes skipped rows in the rejected CSV", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 2, created: 0, duplicate_in_file: 1, already_exists: 1, rejected: 0 },
          results: [
            {
              row_number: 2,
              status: "already_exists",
              original: { "Student Name": "Existing" },
              existing_match: {
                student_id: "202812345678",
                student_name: "Existing Student",
                school_name: "JNV Other",
                school_code: "JNV999",
                udise_code: "99999999999",
                district: "Jaipur",
                state: "Rajasthan",
                grade: 11,
                program: "JNV NVS",
                stream: "engineering",
              },
            },
            { row_number: 3, status: "duplicate_in_file", original: { "Student Name": "Duplicate" } },
          ],
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await user.upload(
      screen.getByLabelText("Student upload file"),
      new File(["fake"], "students.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Upload students" }));

    await waitFor(() => expect(screen.getByText("0 done, 2 to go")).toBeInTheDocument());
    expect(screen.getByText(/This identifier already belongs to Existing Student/)).toBeInTheDocument();
    expect(screen.getByText(/JNV999, UDISE 99999999999/)).toBeInTheDocument();
    const download = screen.getByRole("link", { name: "Download rejected rows CSV" });
    expect(download).toHaveAttribute("href", expect.stringContaining("Existing"));
    expect(download).toHaveAttribute("href", expect.stringContaining("Duplicate"));
    expect(download).toHaveAttribute("href", expect.stringContaining("Different%20school"));
  });

  it("uses school code for same-school duplicate messages", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 1, rejected: 0 },
          results: [
            {
              row_number: 2,
              status: "already_exists",
              original: { "Student Name": "Existing" },
              existing_match: {
                student_id: "202812345678",
                student_name: "Existing Student",
                school_code: "JNV001",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await user.upload(
      screen.getByLabelText("Student upload file"),
      new File(["fake"], "students.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Upload students" }));

    await waitFor(() => {
      expect(screen.getByText(/already part of this school/)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Download rejected rows CSV" })).toHaveAttribute(
      "href",
      expect.stringContaining("Same%20school"),
    );
  });

  it("resets upload state when reopened", async () => {
    const { rerender } = render(<BulkStudentUploadModal {...baseProps} />);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("Student upload file"),
      new File(["fake"], "students.csv", { type: "text/csv" }),
    );

    expect(screen.getByLabelText("Student upload file")).toHaveProperty("files", expect.objectContaining({ length: 1 }));

    rerender(<BulkStudentUploadModal {...baseProps} open={false} />);
    rerender(<BulkStudentUploadModal {...baseProps} open />);

    expect(screen.getByLabelText("Student upload file")).toHaveProperty("files", expect.objectContaining({ length: 0 }));
  });
});
