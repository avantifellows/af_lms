import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  APPROVED_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
} from "@/lib/registration-mode";
import BulkStudentUploadModal from "./BulkStudentUploadModal";

const baseProps = {
  open: true,
  schoolUdise: "12345678901",
  schoolCode: "JNV001",
  onClose: vi.fn(),
  onUploaded: vi.fn(),
  registrationMode: APPROVED_REGISTRATION_MODE,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function checkedResponse({
  readyCount = 1,
  needsCorrectionCount = 0,
  rejectedRows = [],
  ignoredRows = [],
}: {
  readyCount?: number;
  needsCorrectionCount?: number;
  rejectedRows?: unknown[];
  ignoredRows?: Array<{ message: string }>;
} = {}) {
  const readyRows = Array.from({ length: readyCount }, (_, index) => ({
    row_number: index + 2,
    status: "ready",
    original: { "Student Name": `Ready ${index + 1}`, Grade: "11" },
  }));
  return response({
    stage: "checked",
    summary: {
      total: readyCount + needsCorrectionCount,
      ready: readyCount,
      rejected: needsCorrectionCount,
    },
    rows: [...readyRows, ...rejectedRows],
    ignored_rows: ignoredRows,
  });
}

function finalResponse({
  total = 1,
  created = 1,
  duplicateInFile = 0,
  alreadyExists = 0,
  rejected = 0,
  results = [],
}: {
  total?: number;
  created?: number;
  duplicateInFile?: number;
  alreadyExists?: number;
  rejected?: number;
  results?: unknown[];
} = {}) {
  return response({
    action: "upload",
    totals: {
      total,
      created,
      duplicate_in_file: duplicateInFile,
      already_exists: alreadyExists,
      rejected,
    },
    results,
  });
}

function file(name = "students.xlsx") {
  return new File(["spreadsheet bytes"], name, {
    type: name.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function selectFile(user: ReturnType<typeof userEvent.setup>, name = "students.xlsx") {
  const selected = file(name);
  await user.upload(screen.getByLabelText("Student upload file"), selected);
  return selected;
}

async function checkFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Check spreadsheet" }));
}

describe("BulkStudentUploadModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("keeps selection inert, checks without writing, then adds exactly once", async () => {
    const rejected = {
      row_number: 3,
      status: "rejected",
      original: { "Student Name": "Bad Student", Grade: "11" },
      field_errors: { stream: "Primary Exam preparing for is not valid" },
      row_errors: ["PEN or Grade 10 Roll no is required"],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({
        readyCount: 1,
        needsCorrectionCount: 1,
        rejectedRows: [rejected],
        ignoredRows: [{ message: "Row 7 was ignored as the example row. Matched: PEN." }],
      }))
      .mockResolvedValueOnce(finalResponse({
        total: 2,
        created: 1,
        rejected: 1,
        results: [
          {
            row_number: 2,
            status: "created",
            generated_student_id: "202712345678",
            original: { "Student Name": "Created Student", Grade: "12" },
          },
          rejected,
        ],
      }));

    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);
    const selected = await selectFile(user);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();

    await checkFile(user);
    await screen.findByText("Nothing has been added yet.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(baseProps.onUploaded).not.toHaveBeenCalled();
    expect(screen.getByText("1 row passed spreadsheet checks")).toBeInTheDocument();
    expect(screen.getByText("2 rows checked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spreadsheet check complete" })).toBeInTheDocument();
    expect(screen.getByText(/Only the 1 row that passed will continue/)).toBeInTheDocument();
    expect(screen.getByText("1 row needs correction — these will not be added")).toBeInTheDocument();
    expect(screen.getByText("Row 7 was ignored as the example row. Matched: PEN.")).toBeInTheDocument();
    expect(screen.getByText("Needs correction")).toBeInTheDocument();
    const checkForm = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(Array.from(checkForm.keys())).toEqual(["file", "action"]);
    expect(checkForm.get("action")).toBe("validate");
    expect((checkForm.get("file") as File).name).toBe(selected.name);

    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const addForm = vi.mocked(fetch).mock.calls[1][1]?.body as FormData;
    expect(addForm.get("action")).toBe("upload");
    expect((addForm.get("file") as File).name).toBe(selected.name);
    expect(screen.getByText("Added 1")).toBeInTheDocument();
    expect(screen.getByText("Already present 0")).toBeInTheDocument();
    expect(screen.getByText("Rejected 1")).toBeInTheDocument();
    expect(baseProps.onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload another file" })).toBeInTheDocument();
  });

  it("shows the template note once above multiple choice errors and carries messages through final results and CSV", async () => {
    const message = "Board Stream: “Commerce (without Maths)” isn’t supported. Allowed values: PCM, PCB, PCMB, Commerce (Math), Commerce (Without Math), Arts/Humanities.";
    const note = "Use the choices from a freshly downloaded LMS template. Editing the spreadsheet’s dropdown list does not change the values LMS accepts.";
    const rejectedRows = [3, 4].map((row_number) => ({
      row_number, status: "rejected", field_errors: { board_stream: message },
      unsupported_choice_fields: ["board_stream"], original: { "Board Stream": "Commerce (without Maths)" },
    }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1, needsCorrectionCount: 2, rejectedRows }))
      .mockResolvedValueOnce(finalResponse({ total: 3, created: 1, rejected: 2, results: [{ row_number: 2, status: "created" }, ...rejectedRows] }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);
    await selectFile(user);
    await checkFile(user);
    const guidance = await screen.findByText(note);
    expect(screen.getAllByText(note)).toHaveLength(1);
    expect(guidance.nextElementSibling).toContainElement(screen.getByRole("table", { name: "Rows needing correction" }));
    expect(screen.getAllByText(message)).toHaveLength(2);
    const previewCsv = decodeURIComponent(screen.getByRole("link", { name: "Download rows needing correction" }).getAttribute("href")!);
    expect(previewCsv).toContain(message);
    expect(previewCsv).not.toContain(note);
    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });
    expect(screen.getAllByText(message)).toHaveLength(2);
    expect(decodeURIComponent(screen.getByRole("link", { name: "Download rejected rows CSV" }).getAttribute("href")!)).toBe(previewCsv);
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("separates field and row errors with line breaks in preview and final results", async () => {
    const fieldMessage = "Gender: “F” isn’t supported. Allowed values: Female, Male, Other.";
    const rowMessage = "Correct this row before uploading.";
    const rejectedRow = {
      row_number: 3, status: "rejected", field_errors: { gender: fieldMessage },
      row_errors: [rowMessage],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1, needsCorrectionCount: 1, rejectedRows: [rejectedRow] }))
      .mockResolvedValueOnce(finalResponse({ total: 2, created: 1, rejected: 1, results: [{ row_number: 2, status: "created" }, rejectedRow] }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);
    await selectFile(user);
    await checkFile(user);
    const expected = `${fieldMessage}\n${rowMessage}`;
    expect(await screen.findByText((_, element) => element?.tagName === "TD" && element.textContent === expected)).toHaveClass("whitespace-pre-wrap");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });
    expect(screen.getByText((_, element) => element?.tagName === "TD" && element.textContent === expected)).toHaveClass("whitespace-pre-wrap");
  });

  it.each([
    { field_errors: { board_stream: "Board Stream is required" } },
    { row_errors: ["Parents Phone Number is repeated in this file."] },
    { field_errors: { phone: "Enter a valid phone number" }, unsupported_choice_fields: "phone" },
    { field_errors: {}, unsupported_choice_fields: [null, 1, "board_stream"] },
  ])("hides template guidance for unrelated errors and malformed metadata: %j", async (errors) => {
    vi.mocked(fetch).mockResolvedValueOnce(checkedResponse({ readyCount: 0, needsCorrectionCount: 1, rejectedRows: [{ row_number: 2, status: "rejected", ...errors }] }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);
    await selectFile(user);
    await checkFile(user);
    await screen.findByRole("table", { name: "Rows needing correction" });
    expect(screen.queryByText(/Use the choices from a freshly downloaded LMS template/)).not.toBeInTheDocument();
  });

  it("cancels safely after checking and clears the checked state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(checkedResponse({ readyCount: 2 }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("2 rows passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    expect(baseProps.onUploaded).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Nothing has been added yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check spreadsheet" })).toBeDisabled();
  });

  it("sends only one check request for synchronous duplicate submits", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(checkedResponse({ readyCount: 1 }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    const form = screen.getByRole("button", { name: "Check spreadsheet" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await screen.findByText("1 row passed spreadsheet checks");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("renders complete check and final responses with duplicate row labels", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        stage: "checked",
        summary: { total: 2, ready: 2, rejected: 0 },
        rows: [
          { row_number: 2, status: "ready", original: { "Student Name": "First" } },
          { row_number: 2, status: "ready", original: { "Student Name": "Second" } },
        ],
      }))
      .mockResolvedValueOnce(finalResponse({
        total: 2,
        created: 2,
        results: [
          { row_number: 2, status: "created", original: { "Student Name": "First" } },
          { row_number: 2, status: "created", original: { "Student Name": "Second" } },
        ],
      }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("2 rows passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));

    await screen.findByRole("heading", { name: "Upload complete" });
    expect(screen.getByText("Added 2")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(baseProps.onUploaded).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale check response repopulate after cancel", async () => {
    let resolveCheck!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveCheck = resolve;
    }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    resolveCheck(checkedResponse({ readyCount: 1 }));

    await waitFor(() => expect(screen.queryByText("Nothing has been added yet.")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Check spreadsheet" })).toBeDisabled();
  });

  it("shows all-invalid checked rows without offering Add", async () => {
    const rejectedRows = [
      {
        row_number: 2,
        status: "rejected",
        original: { "Student Name": "Bad One", Grade: "10" },
        field_errors: { grade: "Grade must be 11 or 12" },
      },
      {
        row_number: 3,
        status: "rejected",
        original: { "Student Name": "Bad Two", Grade: "11" },
        row_errors: ["PEN or Grade 10 Roll no is required"],
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(checkedResponse({
      readyCount: 0,
      needsCorrectionCount: 2,
      rejectedRows,
    }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user, "all-invalid.csv");
    await checkFile(user);
    await screen.findByText("0 rows passed spreadsheet checks");
    expect(screen.getByText("2 rows need correction — these will not be added")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
    const download = screen.getByRole("link", { name: "Download rows needing correction" });
    const href = download.getAttribute("href") ?? "";
    expect(href).toContain("Bad%20One");
    expect(href).toContain("Bad%20Two");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(baseProps.onUploaded).not.toHaveBeenCalled();
  });

  it("keeps ready rows out of the checked rejected CSV and resets for the same file", async () => {
    const good = {
      row_number: 2,
      status: "rejected",
      original: { "Student Name": "Good Student", Grade: "11" },
    };
    const bad = {
      row_number: 3,
      status: "rejected",
      original: { "Student Name": "Bad Student", Grade: "10" },
      field_errors: { grade: "Grade must be 11 or 12" },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1, needsCorrectionCount: 1, rejectedRows: [bad] }))
      .mockResolvedValueOnce(finalResponse({
        total: 2,
        created: 1,
        rejected: 1,
        results: [
          { row_number: 2, status: "created", original: good.original },
          bad,
        ],
      }))
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    const selected = await selectFile(user);
    await checkFile(user);
    await screen.findByText("1 row needs correction — these will not be added");
    const previewCsv = screen.getByRole("link", { name: "Download rows needing correction" });
    const previewHref = previewCsv.getAttribute("href") ?? "";
    expect(previewHref).toContain("Bad%20Student");
    expect(previewHref).not.toContain("Good%20Student");

    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });
    await user.click(screen.getByRole("button", { name: "Upload another file" }));
    expect(screen.getByLabelText("Student upload file")).toHaveProperty("files", expect.objectContaining({ length: 0 }));
    expect(screen.queryByRole("heading", { name: "Upload complete" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing has been added yet.")).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("Student upload file"), selected);
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(baseProps.onUploaded).toHaveBeenCalledTimes(1);
  });

  it("preserves exact template mismatch details and clears them after a new file", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        error: "This upload does not match the active Phone Registration Mode template.",
        template_mismatch: {
          missing: ["Gender"],
          unexpected: ["Unapproved column"],
          duplicate: ["Grade"],
        },
      }, 400))
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} registrationMode={PHONE_REGISTRATION_MODE} />);

    await selectFile(user, "wrong.csv");
    await checkFile(user);
    expect(await screen.findByText("The uploaded headers do not match the current template.")).toBeInTheDocument();
    expect(screen.getByText("Missing columns: Gender")).toBeInTheDocument();
    expect(screen.getByText("Unrecognized columns: Unapproved column")).toBeInTheDocument();
    expect(screen.getByText("Duplicate columns: Grade")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download the current template" })).toHaveAttribute(
      "download",
      "NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx",
    );
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();

    await selectFile(user, "correct.csv");
    expect(screen.queryByText("Missing columns: Gender")).not.toBeInTheDocument();
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");
  });

  it("resets the selected file and checked state when upload context changes", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }))
      .mockResolvedValueOnce(checkedResponse({ readyCount: 2 }));
    const user = userEvent.setup();
    const { rerender } = render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");

    rerender(<BulkStudentUploadModal {...baseProps} schoolUdise="98765432109" />);
    await waitFor(() => {
      expect(screen.getByLabelText("Student upload file")).toHaveProperty("files", expect.objectContaining({ length: 0 }));
      expect(screen.queryByText("1 row passed spreadsheet checks")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Check spreadsheet" })).toBeDisabled();

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("2 rows passed spreadsheet checks");

    rerender(<BulkStudentUploadModal {...baseProps} schoolUdise="98765432109" registrationMode={PHONE_REGISTRATION_MODE} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Student upload file")).toHaveProperty("files", expect.objectContaining({ length: 0 }));
      expect(screen.queryByText("2 rows passed spreadsheet checks")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Check spreadsheet" })).toBeDisabled();
  });

  it("rejects a check response that does not match the checked contract", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({
      stage: "checked",
      summary: { total: 1, ready: 1, rejected: 0 },
    }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not check this file");
    expect(screen.queryByText(/passed spreadsheet checks/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
  });

  it("shows final existing and duplicate outcomes as completed rejected results", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 2 }))
      .mockResolvedValueOnce(finalResponse({
        total: 2,
        created: 0,
        duplicateInFile: 1,
        alreadyExists: 1,
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
            },
          },
          {
            row_number: 3,
            status: "duplicate_in_file",
            original: { "Student Name": "Duplicate" },
            duplicate_identifiers: ["PEN Number", "Grade 10 Roll no"],
          },
        ],
      }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("2 rows passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });

    expect(screen.getByText("Added 0")).toBeInTheDocument();
    expect(screen.getByText("Already present 1")).toBeInTheDocument();
    expect(screen.getByText("Rejected 1")).toBeInTheDocument();
    expect(screen.getByText("Already present")).toBeInTheDocument();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    expect(screen.getByText(/This identifier already belongs to Existing Student/)).toBeInTheDocument();
    expect(screen.getByText("Duplicate in uploaded file: PEN Number, Grade 10 Roll no")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
    expect(baseProps.onUploaded).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download rejected rows CSV" })).toBeInTheDocument();
  });

  it("redacts restricted Phone-mode fields in final rows and CSV", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }))
      .mockResolvedValueOnce(finalResponse({
        total: 1,
        created: 0,
        alreadyExists: 1,
        results: [{
          row_number: 6,
          status: "already_exists",
          original: {
            Grade: "12",
            "Student Name": "Existing Student",
            "Parents Phone Number": "6876543210",
          },
          existing_match: {
            school_code: "JNV001",
            pen_number: "12345678901",
            apaar_id: "123456789012",
          },
        }],
      }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} registrationMode={PHONE_REGISTRATION_MODE} />);

    await selectFile(user, "students.csv");
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    await screen.findByRole("heading", { name: "Upload complete" });

    expect(screen.getByText(
      "This student identifier is already part of this school. Student ID / Phone Number: 6876543210.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/12345678901/)).not.toBeInTheDocument();
    expect(screen.queryByText(/123456789012/)).not.toBeInTheDocument();
    const href = screen.getByRole("link", { name: "Download rejected rows CSV" }).getAttribute("href") ?? "";
    expect(href).toContain("Parents%20Phone%20Number");
    expect(href).not.toContain("PEN%20Number");
    expect(href).not.toContain("Grade%2010%20Roll%20no");
    expect(href).not.toContain("Yearly%20%2F%20Annual%20Family%20Income");
    expect(href).not.toContain("12345678901");
    expect(href).not.toContain("123456789012");
  });

  it("does not offer an Add retry when the final response is unknown", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }))
      .mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));

    expect(await screen.findByText(/final result was not returned/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload another file" })).toBeInTheDocument();
    expect(baseProps.onUploaded).toHaveBeenCalledTimes(1);
  });

  it("treats final totals without a complete results array as unknown", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(checkedResponse({ readyCount: 1 }))
      .mockResolvedValueOnce(response({
        error: "Student could not be created",
        totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
      }, 500));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);

    await selectFile(user);
    await checkFile(user);
    await screen.findByText("1 row passed spreadsheet checks");
    await user.click(screen.getByRole("button", { name: "Check & add students" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Student could not be created");
    expect(screen.getByRole("alert")).toHaveTextContent(/final result was not returned/);
    expect(baseProps.onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Check & add students" })).not.toBeInTheDocument();
  });

  it("exposes accessible dialog and busy labels during checking and adding", async () => {
    let resolveCheck!: (value: Response) => void;
    let resolveAdd!: (value: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCheck = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveAdd = resolve; }));
    const user = userEvent.setup();
    render(<BulkStudentUploadModal {...baseProps} />);
    expect(screen.getByRole("dialog", { name: "Bulk Upload Students" })).toHaveAttribute("aria-modal", "true");

    await selectFile(user);
    await checkFile(user);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByText(/Checking spreadsheet/)).toHaveAttribute("role", "status");
    resolveCheck(checkedResponse({ readyCount: 1 }));
    await screen.findByText("1 row passed spreadsheet checks");

    await user.click(screen.getByRole("button", { name: "Check & add students" }));
    expect(screen.getByRole("button", { name: "Checking & adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    resolveAdd(finalResponse({ results: [{ row_number: 2, status: "created" }] }));
    await screen.findByRole("heading", { name: "Upload complete" });
  });
});
