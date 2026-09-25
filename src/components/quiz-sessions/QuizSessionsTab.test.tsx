import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuizSessionsTab from "./QuizSessionsTab";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function makeBatches() {
  return [
    {
      id: 5,
      name: "Parent Batch 11 Engg",
      batch_id: "EnableStudents_11_Engg",
      parent_id: null,
      program_id: 1,
    },
    {
      id: 11,
      name: "Class 11 Engg A",
      batch_id: "EnableStudents_11_Engg_A",
      parent_id: 5,
      program_id: 1,
    },
    {
      id: 12,
      name: "Class 11 Engg B",
      batch_id: "EnableStudents_11_Engg_B",
      parent_id: 5,
      program_id: 1,
    },
    {
      id: 7,
      name: "Parent Batch 11 Med",
      batch_id: "EnableStudents_11_Med",
      parent_id: null,
      program_id: 1,
    },
    {
      id: 21,
      name: "Class 11 Med A",
      batch_id: "EnableStudents_11_Med_A",
      parent_id: 7,
      program_id: 1,
    },
  ];
}

function makeTargetProgramBatches() {
  return [
    {
      id: 958,
      name: "JNV CoE 2028 Engineering Quiz Batch",
      batch_id: "EN-TP-2028-engg-C01",
      parent_id: null,
      program_id: 1,
    },
    {
      id: 5541,
      name: "CoE JNV Hassan 2028 Engineering",
      batch_id: "EnableStudents_TP_2028_engg_C013",
      parent_id: 958,
      program_id: 1,
    },
    {
      id: 5542,
      name: "CoE JNV Kottayam 2028 Engineering",
      batch_id: "EnableStudents_TP_2028_engg_C017",
      parent_id: 958,
      program_id: 1,
    },
  ];
}

function makeSessions() {
  return [
    {
      id: 1,
      name: "Existing Quiz",
      start_time: "2026-04-15T05:00:00.000Z",
      end_time: "2026-04-15T09:00:00.000Z",
      is_active: true,
      portal_link: "https://quiz.example/1",
      meta_data: {
        batch_id: "EnableStudents_11_Engg_A",
        test_code: "PT-ENGG-A",
        resource_name: "Existing Quiz",
        status: "ready",
        etl_sync_status: "synced",
        etl_synced_at: "2026-04-15T09:30:00.000Z",
        has_synced_to_bq: true,
      },
    },
    {
      id: 2,
      name: "Second Quiz",
      start_time: "2026-04-15T05:00:00.000Z",
      end_time: "2026-04-15T09:00:00.000Z",
      is_active: true,
      portal_link: "https://quiz.example/2",
      meta_data: {
        batch_id: "EnableStudents_11_Engg_B",
        test_code: "PT-ENGG-B",
        resource_name: "Second Quiz",
        status: "ready",
        has_synced_to_bq: false,
      },
    },
    {
      id: 3,
      name: "Synced Quiz With Last Time",
      start_time: "2026-04-15T05:00:00.000Z",
      end_time: "2026-04-15T09:00:00.000Z",
      is_active: true,
      portal_link: "https://quiz.example/3",
      meta_data: {
        batch_id: "EnableStudents_11_Engg_A",
        test_code: "PT-SYNCED",
        resource_name: "Synced Quiz With Last Time",
        status: "ready",
        has_synced_to_bq: true,
        etl_last_synced_at: "2026-05-07T07:24:38+00:00",
      },
    },
  ];
}

function makeTemplate() {
  return {
    id: 501,
    code: "PT-11",
    name: "Part Test 11",
    grade: 11,
    course: "JEE",
    stream: "engineering",
    testFormat: "part_test",
    testPurpose: "weekly_test",
    testType: "assessment",
    optionalLimits: "JEE",
    cmsLink: "https://cms.example/tests/pt-11",
    cmsSourceId: "pt-11",
    questionPdf: "https://cdn.example/question.pdf",
    solutionPdf: "https://cdn.example/solution.pdf",
    rankingCutoffDate: "2026-04-20",
    sheetName: "Sheet 1",
  };
}

function getFetchCalls(mockFetch: ReturnType<typeof vi.fn>, pathPrefix: string) {
  return mockFetch.mock.calls.filter(([input]) => String(input).startsWith(pathPrefix));
}

describe("QuizSessionsTab", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let sessions: ReturnType<typeof makeSessions>;
  let createdPayload: Record<string, unknown> | null;

  beforeEach(() => {
    sessions = makeSessions();
    createdPayload = null;

    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.startsWith("/api/quiz-sessions/batches")) {
        return jsonResponse({ batches: makeBatches() });
      }

      if (url.startsWith("/api/quiz-sessions/templates")) {
        return jsonResponse({ templates: [makeTemplate()] });
      }

      if (url.startsWith("/api/quiz-sessions?")) {
        const parsed = new URL(url, "http://localhost");
        const classBatchId = parsed.searchParams.get("classBatchId");
        const cmsTestId = parsed.searchParams.get("cmsTestId");
        const resourceId = parsed.searchParams.get("resourceId");
        const filtered = sessions
          .filter(
            (session) =>
              !classBatchId ||
              String(session.meta_data?.batch_id || "")
                .split(",")
                .includes(classBatchId)
          )
          .filter(
            (session) =>
              (!cmsTestId || String(session.meta_data?.cms_test_id) === cmsTestId) &&
              (!resourceId || String(session.meta_data?.resource_id) === resourceId)
          );
        return jsonResponse({ sessions: filtered, hasMore: false });
      }

      if (url === "/api/quiz-sessions" && init?.method === "POST") {
        createdPayload = JSON.parse(String(init.body));
        sessions = [
          {
            id: 99,
            name: String(createdPayload.name || "Part Test 11"),
            start_time: String(createdPayload.startTime),
            end_time: String(createdPayload.endTime),
            is_active: true,
            portal_link: null,
            meta_data: {
              batch_id: Array.isArray(createdPayload.classBatchIds)
                ? createdPayload.classBatchIds.join(",")
                : "",
              test_code: "PT-11",
              resource_name: "Part Test 11",
              status: "pending",
              etl_sync_status: "pending",
              has_synced_to_bq: false,
            },
          },
          ...sessions,
        ];
        return jsonResponse({ id: 99 });
      }

      const editSessionMatch = url.match(/^\/api\/quiz-sessions\/(\d+)$/);
      if (editSessionMatch && init?.method === "PATCH") {
        const sessionId = Number(editSessionMatch[1]);
        const editPayload = JSON.parse(String(init.body)) as {
          name?: string;
          startTime?: string;
          endTime?: string;
        };

        if (editPayload.name === "Server Rejected") {
          return jsonResponse({ error: "Session overlaps an existing window" }, 409);
        }

        sessions = sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                name: editPayload.name ?? session.name,
                start_time: editPayload.startTime ?? session.start_time,
                end_time: editPayload.endTime ?? session.end_time,
              }
            : session
        );
        return jsonResponse({ id: sessionId });
      }

      if (url.startsWith("/api/cms/tests")) {
        return jsonResponse({
          tests: [{ id: 42, name: "NEET Major 1", code: "NM-1", marks: 720, duration: 200 }],
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("filters sessions by class batch", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();
    expect(screen.getByText("Second Quiz")).toBeInTheDocument();
    expect(screen.getByText("Synced Quiz With Last Time")).toBeInTheDocument();
    expect(
      screen.getByText("Results sync automatically every 60 minutes. Manual sync is not needed.")
    ).toBeInTheDocument();

    await user.selectOptions(screen.getAllByRole("combobox")[0], "EnableStudents_11_Engg_B");

    await waitFor(() => {
      expect(screen.queryByText("Existing Quiz")).not.toBeInTheDocument();
      expect(screen.queryByText("Synced Quiz With Last Time")).not.toBeInTheDocument();
      expect(screen.getByText("Second Quiz")).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("classBatchId=EnableStudents_11_Engg_B")
    );
  });

  it("keeps view-only users away from create and edit actions", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Quiz Session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open actions" })).not.toBeInTheDocument();
    expect(screen.getAllByText("View only")).toHaveLength(3);

    await user.click(screen.getByText("Existing Quiz"));

    expect(screen.getByRole("heading", { name: "Session Details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a pending LMS session from same-parent class batches and a selected paper", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Create Quiz Session" })
    );
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.click(screen.getByLabelText("Class 11 Engg B"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");

    expect(await screen.findByText("Part Test 11")).toBeInTheDocument();
    await user.click(screen.getByText("Part Test 11"));
    await user.click(screen.getByRole("button", { name: "Advanced Settings" }));
    await user.click(screen.getByLabelText("Shuffle question order"));
    expect(screen.getByRole("button", { name: "Q & A" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "OMR" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Both" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(createdPayload).toMatchObject({
        resourceId: 501,
        grade: 11,
        parentBatchId: "EnableStudents_11_Engg",
        classBatchIds: ["EnableStudents_11_Engg_A", "EnableStudents_11_Engg_B"],
        stream: "engineering",
        name: "Part Test 11",
        showAnswers: false,
        showScores: true,
        shuffle: true,
        gurukulFormatType: "qa",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Create Quiz Session" })).not.toBeInTheDocument();
      expect(screen.getByText("Part Test 11")).toBeInTheDocument();
      expect(screen.getByText("Processing")).toBeInTheDocument();
      expect(screen.getByText("Queued")).toBeInTheDocument();
    });

    const templateCallUrl = String(getFetchCalls(mockFetch, "/api/quiz-sessions/templates?")[0][0]);
    const templateParams = new URL(templateCallUrl, "http://localhost").searchParams;
    expect(templateParams.get("grade")).toBe("11");
    expect(templateParams.get("stream")).toBe("engineering");
    expect(templateParams.get("testFormat")).toBe("part_test");
  });

  it("creates a session from target-program batch IDs", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.startsWith("/api/quiz-sessions/batches")) {
        return jsonResponse({ batches: makeTargetProgramBatches() });
      }

      if (url.startsWith("/api/quiz-sessions/templates")) {
        return jsonResponse({ templates: [makeTemplate()] });
      }

      if (url.startsWith("/api/quiz-sessions?")) {
        return jsonResponse({ sessions: [], hasMore: false });
      }

      if (url === "/api/quiz-sessions" && init?.method === "POST") {
        createdPayload = JSON.parse(String(init.body));
        return jsonResponse({ id: 99 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByLabelText("CoE JNV Hassan 2028 Engineering"));
    await user.click(screen.getByLabelText("CoE JNV Kottayam 2028 Engineering"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");

    expect(await screen.findByText("Part Test 11")).toBeInTheDocument();
    await user.click(screen.getByText("Part Test 11"));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(createdPayload).toMatchObject({
        grade: 11,
        parentBatchId: "EN-TP-2028-engg-C01",
        classBatchIds: [
          "EnableStudents_TP_2028_engg_C013",
          "EnableStudents_TP_2028_engg_C017",
        ],
        stream: "engineering",
      });
    });

    const templateCallUrl = String(getFetchCalls(mockFetch, "/api/quiz-sessions/templates?")[0][0]);
    const templateParams = new URL(templateCallUrl, "http://localhost").searchParams;
    expect(templateParams.get("grade")).toBe("11");
    expect(templateParams.get("stream")).toBe("engineering");
  });

  it("allows a selected paper to be deselected", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Create Quiz Session" })
    );
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");

    const paper = await screen.findByRole("button", { name: /Part Test 11/ });
    await user.click(paper);
    expect(paper).toHaveAttribute("aria-pressed", "true");

    await user.click(paper);
    expect(paper).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Create Session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please select a paper."
    );
    expect(createdPayload).toBeNull();
  });

  it("does not offer hiring or evaluation test formats in session creation", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Create Quiz Session" })
    );

    const formatSelect = screen.getByLabelText("Test Format");
    expect(
      within(formatSelect).queryByRole("option", { name: "Hiring Test" })
    ).not.toBeInTheDocument();
    expect(
      within(formatSelect).queryByRole("option", { name: "Evaluation Test" })
    ).not.toBeInTheDocument();
  });

  it("shows compact sync status without manual sync controls", async () => {
    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();
    expect(
      screen.getByText("Results sync automatically every 60 minutes. Manual sync is not needed.")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Results sync automatically every 60 minutes. Manual sync is not needed.")
    ).toHaveLength(1);

    const existingQuizRow = screen.getByText("Existing Quiz").closest("tr");
    expect(existingQuizRow).not.toBeNull();
    const secondQuizRow = screen.getByText("Second Quiz").closest("tr");
    expect(secondQuizRow).not.toBeNull();
    const syncedWithLastTimeRow = screen.getByText("Synced Quiz With Last Time").closest("tr");
    expect(syncedWithLastTimeRow).not.toBeNull();

    expect(
      within(existingQuizRow as HTMLTableRowElement).getByText(/Last synced:/)
    ).toBeInTheDocument();
    expect(
      within(existingQuizRow as HTMLTableRowElement).queryByRole("button", { name: /sync/i })
    ).not.toBeInTheDocument();
    expect(
      within(existingQuizRow as HTMLTableRowElement).queryByText(/Auto-syncs every/)
    ).not.toBeInTheDocument();
    expect(
      within(secondQuizRow as HTMLTableRowElement).queryByText(/Last synced:/)
    ).not.toBeInTheDocument();
    expect(
      within(secondQuizRow as HTMLTableRowElement).queryByText("Sync time not recorded")
    ).not.toBeInTheDocument();
    expect(
      within(syncedWithLastTimeRow as HTMLTableRowElement).getByText(/Last synced:/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Last synced: -")).not.toBeInTheDocument();
  });

  it("shows create validation errors next to the submit controls", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("At least one class batch is required.");
    expect(alert.parentElement?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Create Session" })
    );
  });

  it("blocks creation when selected class batches do not share a parent batch", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.click(screen.getByLabelText("Class 11 Med A"));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Selected class batches must belong to the same parent batch."
    );
    expect(createdPayload).toBeNull();
    expect(getFetchCalls(mockFetch, "/api/quiz-sessions/templates?")).toHaveLength(0);
  });

  it("shows edit validation errors next to the save controls", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(screen.getByText("Existing Quiz"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByDisplayValue("Existing Quiz"));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Session name is required.");
    expect(alert.parentElement?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Save Changes" })
    );
  });

  it("shows edit API errors next to the save controls without closing the modal", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    await user.click(screen.getByText("Existing Quiz"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByDisplayValue("Existing Quiz");
    await user.clear(nameInput);
    await user.type(nameInput, "Server Rejected");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Session overlaps an existing window");
    expect(alert.parentElement?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Save Changes" })
    );
    expect(screen.getByRole("heading", { name: "Edit Quiz Session" })).toBeInTheDocument();
  });

  it("shows question and answer PDFs for new-CMS tests before creating", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByRole("button", { name: "New CMS Test" }));
    await user.selectOptions(screen.getByDisplayValue("Chapter Test"), "major_test");
    await user.selectOptions(screen.getByDisplayValue("Select exam track"), "neet");
    await user.selectOptions(screen.getByDisplayValue("Select grade"), "12");

    expect(await screen.findByText("NEET Major 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Question PDF" })).toHaveAttribute(
      "href",
      "/api/cms/test-pdf?testId=42&type=questions"
    );
    expect(screen.getByRole("link", { name: "Answer PDF" })).toHaveAttribute(
      "href",
      "/api/cms/test-pdf?testId=42&type=answers"
    );

    // Opening a PDF must not toggle the test selection.
    await user.click(screen.getByRole("link", { name: "Answer PDF" }));
    expect(screen.getByText("NEET Major 1").closest("[role=button]")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("nudges towards extending an earlier session of the same paper", async () => {
    sessions = [
      {
        ...makeSessions()[0],
        id: 7,
        name: "Part Test 11 - Round 1",
        meta_data: { ...makeSessions()[0].meta_data, resource_id: 501 },
      },
      {
        ...makeSessions()[0],
        id: 8,
        name: "Part Test 11 - Disabled",
        is_active: false,
        meta_data: { ...makeSessions()[0].meta_data, resource_id: 501 },
      },
      ...makeSessions(),
    ];
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");
    await user.click(await screen.findByText("Part Test 11"));

    const dialog = screen.getByRole("heading", { name: "Create Quiz Session" }).closest("div.fixed") as HTMLElement;
    expect(
      await within(dialog).findByText("This test already has a session for the selected batches")
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Part Test 11 - Disabled")).not.toBeInTheDocument();
    // Choosing: no new-session form and no primary action until they pick a path.
    expect(within(dialog).queryByText("3. When And How")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Create Session" })).not.toBeInTheDocument();

    // Create anyway: the notice shrinks to a reminder and the normal form returns.
    await user.click(within(dialog).getByRole("button", { name: "Create a new session anyway" }));
    expect(within(dialog).getByText(/You are creating a new session/)).toBeInTheDocument();
    expect(within(dialog).getByText("3. When And How")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create Session" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Extend an existing one instead" }));

    // Extending: only the end time, and the footer's one primary action saves it.
    await user.click(within(dialog).getByRole("button", { name: "Extend" }));
    expect(within(dialog).queryByText("3. When And How")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Create Session" })).not.toBeInTheDocument();
    const endInput = within(dialog).getByLabelText("New end time");
    await user.clear(endInput);
    await user.type(endInput, "2099-01-01T18:00");
    await user.click(within(dialog).getByRole("button", { name: "Save end time" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Create Quiz Session" })).not.toBeInTheDocument();
    });
    const patchCall = mockFetch.mock.calls.find(
      ([input, init]) => String(input) === "/api/quiz-sessions/7" && init?.method === "PATCH"
    );
    expect(Object.keys(JSON.parse(String(patchCall?.[1]?.body)))).toEqual(["endTime"]);
    expect(await screen.findByText(/Session extended/)).toBeInTheDocument();
    await waitFor(() => {
      expect(getFetchCalls(mockFetch, "/api/quiz-sessions?").some(([input]) =>
        String(input).includes("classBatchId=EnableStudents_11_Engg_A")
      )).toBe(true);
    });
    expect(document.querySelector('[data-session-row="7"]')).toHaveClass("bg-success-bg");
  });

  it("ignores earlier sessions of the paper that ran for other batches", async () => {
    sessions = [
      {
        ...makeSessions()[0],
        id: 7,
        name: "Part Test 11 - Batch B",
        meta_data: {
          ...makeSessions()[0].meta_data,
          batch_id: "EnableStudents_11_Engg_B",
          resource_id: 501,
        },
      },
      ...makeSessions(),
    ];
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");
    await user.click(await screen.findByText("Part Test 11"));

    expect(await screen.findByText("3. When And How")).toBeInTheDocument();
    expect(screen.queryByText(/already has/)).not.toBeInTheDocument();

    // Adding the batch that already ran it brings the nudge up.
    await user.click(screen.getByLabelText("Class 11 Engg B"));
    expect(
      await screen.findByText("This test already has a session for the selected batches")
    ).toBeInTheDocument();
    expect(screen.queryByText("3. When And How")).not.toBeInTheDocument();
  });

  it("shows no nudge when the paper has no earlier session", async () => {
    const user = userEvent.setup();

    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Create Quiz Session" }));
    await user.click(screen.getByLabelText("Class 11 Engg A"));
    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.selectOptions(screen.getByLabelText("Test Format"), "part_test");
    await user.click(await screen.findByText("Part Test 11"));

    await waitFor(() => {
      expect(getFetchCalls(mockFetch, "/api/quiz-sessions?schoolId=school-1&per_page=50")).toHaveLength(1);
    });
    expect(String(getFetchCalls(mockFetch, "/api/quiz-sessions?schoolId=school-1&per_page=50")[0][0])).toContain(
      "resourceId=501"
    );
    expect(await screen.findByText("3. When And How")).toBeInTheDocument();
    expect(screen.queryByText(/already has/)).not.toBeInTheDocument();
  });

  it("does not expose the removed sync endpoint from the UI", async () => {
    render(<QuizSessionsTab schoolId="school-1" canEdit />);

    expect(await screen.findByText("Existing Quiz")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Sync Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Sync" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Again" })).not.toBeInTheDocument();

    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/quiz-sessions\/\d+\/sync/),
      expect.anything()
    );
  });
});
