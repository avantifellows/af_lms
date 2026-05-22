import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import CumulativeALTable from "./CumulativeALTable";

function mockResponse(data: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(data) })
  ) as unknown as typeof fetch;
}

// All-PCM fixture (single stream group). Used for matrix layout tests.
const SAMPLE = {
  tests: [
    { session_id: "s1", test_name: "Test One", start_date: "2025-01-10", stream: "pcm" },
    { session_id: "s2", test_name: "Test Two", start_date: "2025-02-10", stream: "pcm" },
    { session_id: "s3", test_name: "Test Three", start_date: "2025-03-10", stream: "pcm" },
  ],
  students: [
    {
      student_id: "asha",
      student_name: "Asha",
      stream: "PCM",
      total_major_tests: 3,
      al_counts: { M1: 2, M2: 1 },
      mode_al: "M1",
      progression: [
        { session_id: "s1", academic_level: "M2" },
        { session_id: "s2", academic_level: "M1" },
        { session_id: "s3", academic_level: "M1" },
      ],
    },
    {
      student_id: "bilal",
      student_name: "Bilal",
      stream: "PCM",
      total_major_tests: 2,
      al_counts: { M1: 1, M2: 1 },
      mode_al: "M1",
      progression: [
        { session_id: "s1", academic_level: "M2" },
        { session_id: "s3", academic_level: "M1" },
      ],
    },
  ],
};

// Mixed-stream fixture for testing the per-stream matrix grouping.
const MIXED_STREAM_SAMPLE = {
  tests: [
    { session_id: "s1", test_name: "JEE One", start_date: "2025-01-10", stream: "pcm" },
    { session_id: "s2", test_name: "JEE Two", start_date: "2025-02-10", stream: "pcm" },
    { session_id: "c1", test_name: "NEET One", start_date: "2025-01-15", stream: "pcb" },
    { session_id: "c2", test_name: "NEET Two", start_date: "2025-02-15", stream: "pcb" },
  ],
  students: [
    {
      student_id: "asha",
      student_name: "Asha",
      stream: "PCM",
      total_major_tests: 2,
      al_counts: { M1: 1, M2: 1 },
      mode_al: "M1",
      progression: [
        { session_id: "s1", academic_level: "M2" },
        { session_id: "s2", academic_level: "M1" },
      ],
    },
    {
      student_id: "chen",
      student_name: "Chen",
      stream: "PCB",
      total_major_tests: 2,
      al_counts: { B1: 1, B2: 1 },
      mode_al: "B1",
      progression: [
        { session_id: "c1", academic_level: "B2" },
        { session_id: "c2", academic_level: "B1" },
      ],
    },
  ],
};

describe("CumulativeALTable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one matrix column per test plus sticky student/mode/latest cols", async () => {
    vi.stubGlobal("fetch", mockResponse(SAMPLE));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);
    expect(screen.getByText("Loading cumulative data...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Asha")).toBeInTheDocument();
      expect(screen.getByText("Bilal")).toBeInTheDocument();
    });

    // Column headers for each test
    expect(screen.getByText("Test One")).toBeInTheDocument();
    expect(screen.getByText("Test Two")).toBeInTheDocument();
    expect(screen.getByText("Test Three")).toBeInTheDocument();

    // Mode AL / Latest AL header columns are present
    const headers = screen.getAllByRole("columnheader");
    expect(headers.some((h) => /^Mode AL/.test(h.textContent || ""))).toBe(true);
    expect(headers.some((h) => /^Latest AL/.test(h.textContent || ""))).toBe(true);

    // Stream group heading (PCM/JEE/Engineering)
    expect(screen.getByRole("heading", { name: /PCM/ })).toBeInTheDocument();

    // Asha's row should contain three AL chips for the three tests (M2, M1, M1)
    // plus the Mode AL (M1) and Latest AL (M1) chips → 5 chips total in the row
    const ashaRow = screen.getByText("Asha").closest("tr")!;
    const m1Chips = within(ashaRow).getAllByText("M1");
    const m2Chips = within(ashaRow).getAllByText("M2");
    expect(m1Chips.length).toBe(4); // s2 cell + s3 cell + mode + latest
    expect(m2Chips.length).toBe(1); // s1 cell only
  });

  it("renders '—' for tests a student did not take", async () => {
    vi.stubGlobal("fetch", mockResponse(SAMPLE));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);
    await screen.findByText("Bilal");

    // Bilal took s1 and s3 but missed s2 — that cell should be a dash
    const bilalRow = screen.getByText("Bilal").closest("tr")!;
    const dashes = within(bilalRow).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders one matrix per stream — JEE tests don't appear in the NEET section and vice versa", async () => {
    vi.stubGlobal("fetch", mockResponse(MIXED_STREAM_SAMPLE));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);
    await screen.findByText("Asha");
    await screen.findByText("Chen");

    // Two stream group headings
    const headings = screen.getAllByRole("heading");
    const labels = headings.map((h) => h.textContent || "");
    expect(labels.some((l) => /PCM/.test(l))).toBe(true);
    expect(labels.some((l) => /PCB/.test(l))).toBe(true);

    // Asha (PCM) is in the PCM matrix; her row should NOT contain NEET test cells
    const ashaRow = screen.getByText("Asha").closest("tr")!;
    expect(within(ashaRow).queryByText("NEET One")).not.toBeInTheDocument();

    // Chen (PCB) is in the PCB matrix; his row should NOT contain JEE test cells
    const chenRow = screen.getByText("Chen").closest("tr")!;
    expect(within(chenRow).queryByText("JEE One")).not.toBeInTheDocument();

    // Each test name appears once total (in its own group), not duplicated
    expect(screen.getAllByText("JEE One")).toHaveLength(1);
    expect(screen.getAllByText("NEET One")).toHaveLength(1);
  });

  it("forwards stream and program in the request URL", async () => {
    const fetchMock = mockResponse({ students: [], tests: [] });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CumulativeALTable schoolUdise="12345" grade={11} program="JNV CoE" stream="pcm" />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/quiz-analytics/12345/cumulative-als?grade=11&program=JNV%20CoE&stream=pcm"
        ),
        expect.any(Object)
      );
    });
  });

  it("shows empty state when no students", async () => {
    vi.stubGlobal("fetch", mockResponse({ students: [], tests: [] }));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);

    await waitFor(() => {
      expect(
        screen.getByText(/No cumulative AL data available/)
      ).toBeInTheDocument();
    });
  });

  it("displays error from API", async () => {
    vi.stubGlobal("fetch", mockResponse({ error: "boom" }, false, 500));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });

  it("toggles sort direction when clicking a sortable header twice", async () => {
    vi.stubGlobal("fetch", mockResponse(SAMPLE));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);
    await screen.findByText("Asha");

    // Default sort: mode_al desc (Asha and Bilal both M1) → tie broken by tests desc → Asha (3) > Bilal (2)
    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Asha");
    expect(rows[2]).toHaveTextContent("Bilal");

    // Click # column → sort by tests desc → Asha (3) first
    const testsHeader = screen
      .getAllByRole("columnheader")
      .find((h) => (h.textContent || "").trim().startsWith("#"))!;
    fireEvent.click(testsHeader);
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Asha");

    // Click again → asc → Bilal (2) first
    fireEvent.click(testsHeader);
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Bilal");
  });

  it("sorts by Latest AL when that header is clicked", async () => {
    vi.stubGlobal("fetch", mockResponse(SAMPLE));

    render(<CumulativeALTable schoolUdise="12345" grade={11} />);
    await screen.findByText("Asha");

    const latestHeader = screen
      .getAllByRole("columnheader")
      .find((h) => /^Latest AL/.test(h.textContent || ""))!;
    fireEvent.click(latestHeader);
    // Both students have latest=M1 (rank 3) — tie broken by tests desc → Asha first
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Asha");
  });
});
