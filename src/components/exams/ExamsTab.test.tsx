import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExamsTab } from "./ExamsTab";
import type { StudentExamRecord } from "@/lib/competitive-exams";

const EXAMS = [
  { id: 1, name: "JEE Mains" },
  { id: 2, name: "NEET" },
  { id: 3, name: "CUET" },
];

let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Answer the tab's initial load, then whatever the save gets. */
function serve(records: StudentExamRecord[] = [], canReveal = true) {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({ exams: EXAMS, records, can_reveal_password: canReveal }),
  );
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderTab(
  props: Partial<React.ComponentProps<typeof ExamsTab>> = {},
  records: StudentExamRecord[] = [],
  canReveal = true,
) {
  serve(records, canReveal);
  const onSaved = props.onSaved ?? vi.fn();
  render(
    <ExamsTab studentId={7} boardStream={props.boardStream ?? "PCM"} onSaved={onSaved} />,
  );
  await screen.findByLabelText("Add exam");
  return { onSaved };
}

function savedBody() {
  const saveCall = mockFetch.mock.calls.find((call) => call[1]?.method === "PUT");
  if (!saveCall) throw new Error("no save request was made");
  return JSON.parse(saveCall[1].body);
}

const storedJee: StudentExamRecord = {
  id: 10,
  exam_id: 1,
  exam_name: "JEE Mains",
  application_number: "JEE123",
  has_password: true,
  sessions_applied: [1],
  acknowledgements: [],
};

/** The tab opened on a Student with a stored JEE Mains password. */
async function renderStoredJee(canReveal = true) {
  const user = userEvent.setup();
  await renderTab({ boardStream: "PCM" }, [storedJee], canReveal);
  return user;
}

/** Press Save right after the initial load, and wait for the save request. */
async function pressSaveAfterLoad(user: ReturnType<typeof userEvent.setup>) {
  mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));
  await user.click(screen.getByRole("button", { name: "Save Exams" }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
}

/** Press Save, answer it with `records`, and return the first exam it sent. */
async function saveFirstExam(
  user: ReturnType<typeof userEvent.setup>,
  records: StudentExamRecord[] = [],
) {
  mockFetch.mockResolvedValueOnce(jsonResponse({ records }));
  await user.click(screen.getByRole("button", { name: "Save Exams" }));
  await waitFor(() =>
    expect(mockFetch.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(true),
  );
  return savedBody().exams[0];
}

describe("ExamsTab", () => {
  it("opens the exams the Board Stream calls for", async () => {
    await renderTab({ boardStream: "PCM" });

    expect(screen.getByRole("heading", { name: "JEE Mains" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "NEET" })).not.toBeInTheDocument();
  });

  it("opens both exams for PCMB", async () => {
    await renderTab({ boardStream: "PCMB" });

    expect(screen.getByRole("heading", { name: "JEE Mains" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NEET" })).toBeInTheDocument();
  });

  it("opens nothing by default for a stream with no required exam", async () => {
    await renderTab({ boardStream: "Commerce (Math)" });

    expect(screen.getByText(/No exams added yet/)).toBeInTheDocument();
  });

  it("shows only sessions for the exam that runs more than once a year", async () => {
    await renderTab({ boardStream: "PCMB" });

    const jee = screen.getByRole("heading", { name: "JEE Mains" }).closest("div")
      ?.parentElement as HTMLElement;
    expect(within(jee).getByLabelText("Session 1")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Session [12]/)).toHaveLength(2);
  });

  it("masks a stored password and fetches it from the logged reveal route on Show", async () => {
    const user = await renderStoredJee();

    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");

    mockFetch.mockResolvedValueOnce(jsonResponse({ password: "secret" }));
    await user.click(screen.getByRole("button", { name: "Show JEE Mains password" }));

    expect(await screen.findByDisplayValue("secret")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/students/7/exam-records/10/password",
      expect.objectContaining({ method: "POST" }),
    );

    await user.click(screen.getByRole("button", { name: "Hide JEE Mains password" }));

    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");
  });

  it("offers no Show for a role that may not reveal passwords", async () => {
    await renderStoredJee(false);

    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");
    expect(
      screen.queryByRole("button", { name: "Show JEE Mains password" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change JEE Mains password" })).toBeInTheDocument();
  });

  it("says why a reveal was refused", async () => {
    const user = await renderStoredJee();

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Forbidden" }, 403));
    await user.click(screen.getByRole("button", { name: "Show JEE Mains password" }));

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");
  });

  it("drops a reveal that lands after the save it was overtaken by", async () => {
    const user = await renderStoredJee();
    let answerReveal: (res: Response) => void = () => {};
    mockFetch.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (answerReveal = resolve)),
    );
    await user.click(screen.getByRole("button", { name: "Show JEE Mains password" }));
    await user.click(screen.getByLabelText("Session 2"));
    await saveFirstExam(user, [storedJee]);

    await act(async () => answerReveal(jsonResponse({ password: "late-secret" })));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show JEE Mains password" })).toBeEnabled(),
    );
    expect(screen.queryByDisplayValue("late-secret")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");
  });

  it("keeps a stored password on save by leaving it out", async () => {
    const user = await renderStoredJee();

    await user.click(screen.getByLabelText("Session 2"));

    expect(await saveFirstExam(user, [storedJee])).toEqual({
      exam_id: 1,
      application_number: "JEE123",
      sessions_applied: [1, 2],
    });
  });

  it("replaces a stored password through Change", async () => {
    const user = await renderStoredJee();

    await user.click(screen.getByRole("button", { name: "Change JEE Mains password" }));
    const input = screen.getByLabelText("Application password");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, " newpw ");

    expect((await saveFirstExam(user, [storedJee])).application_password).toBe("newpw");
  });

  it("goes back to the stored password when a change is abandoned", async () => {
    const user = await renderStoredJee();

    await user.click(screen.getByRole("button", { name: "Change JEE Mains password" }));
    await user.type(screen.getByLabelText("Application password"), "typo");
    await user.click(screen.getByRole("button", { name: "Keep stored JEE Mains password" }));
    await user.click(screen.getByLabelText("Session 2"));

    expect(await saveFirstExam(user, [storedJee])).not.toHaveProperty("application_password");
  });

  it("removes a stored password, and can undo that before saving", async () => {
    const user = await renderStoredJee();

    await user.click(screen.getByRole("button", { name: "Remove JEE Mains password" }));
    expect(screen.getByText("Password will be removed when you save.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo removing JEE Mains password" }));
    expect(screen.getByLabelText("Application password")).toHaveValue("••••••••");

    await user.click(screen.getByRole("button", { name: "Remove JEE Mains password" }));

    expect((await saveFirstExam(user)).application_password).toBeNull();
  });

  it("sends a new registration's typed password, with its own Show toggle", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" });

    await user.type(screen.getByLabelText("Application number"), "JEE123");
    await user.type(screen.getByLabelText("Application password"), "pw1");
    await user.click(screen.getByRole("button", { name: "Show JEE Mains password" }));
    expect(screen.getByLabelText("Application password")).toHaveAttribute("type", "text");

    expect((await saveFirstExam(user)).application_password).toBe("pw1");
  });

  it("adds an exam from the picker and saves it", async () => {
    const user = userEvent.setup();
    const { onSaved } = await renderTab({ boardStream: "Arts/Humanities" });

    await user.selectOptions(screen.getByLabelText("Add exam"), "3");
    await user.type(screen.getByLabelText("Application number"), " CU-9 ");
    mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody()).toEqual({
      exams: [
        {
          exam_id: 3,
          application_number: "CU-9",
          sessions_applied: [],
        },
      ],
      removed_record_ids: [],
    });
  });

  it("does not offer an exam that is already listed", async () => {
    await renderTab({ boardStream: "PCM" });

    const picker = screen.getByLabelText("Add exam") as HTMLSelectElement;
    expect([...picker.options].map((option) => option.text)).not.toContain("JEE Mains");
    expect([...picker.options].map((option) => option.text)).toContain("NEET");
  });

  it("sends the sittings the teacher ticked", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" });

    await user.type(screen.getByLabelText("Application number"), "JEE123");
    await user.click(screen.getByLabelText("Session 2"));
    await pressSaveAfterLoad(user);
    expect(savedBody().exams[0].sessions_applied).toEqual([2]);
  });

  it("leaves an untouched suggestion unsaved", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" });

    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    expect(await screen.findByText("No exam changes to save")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a save that has a password but no application number", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" });

    await user.type(screen.getByLabelText("Application password"), "secret");
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    expect(
      await screen.findByText(/Application number is required/),
    ).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("removes a stored registration by its record id", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" }, [storedJee]);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await pressSaveAfterLoad(user);
    expect(savedBody()).toEqual({ exams: [], removed_record_ids: [10] });
  });

  it("surfaces the error the save came back with", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" }, [storedJee]);

    await user.clear(screen.getByLabelText("Application number"));
    await user.type(screen.getByLabelText("Application number"), "JEE999");
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Application number JEE999 is already recorded for NEET" }, 400),
    );
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    expect(
      await screen.findByText("Application number JEE999 is already recorded for NEET"),
    ).toBeInTheDocument();
  });

  it("shows a warning when only part of the save went through", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" });

    await user.type(screen.getByLabelText("Application number"), "JEE123");
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ records: [], warnings: ["Could not save NEET: upstream exploded"] }),
    );
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    expect(
      await screen.findByText("Could not save NEET: upstream exploded"),
    ).toBeInTheDocument();
  });

  it("reports a failed load and retries", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 500));
    render(<ExamsTab studentId={7} boardStream="PCM" onSaved={vi.fn()} />);

    expect(await screen.findByText("Failed to load exams (500)")).toBeInTheDocument();

    serve();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Add exam")).toBeInTheDocument();
  });
});

describe("ExamsTab exam acknowledgements", () => {
  const ack = {
    id: 501,
    exam_session: 2,
    pages: [{ page_number: 1, mime_type: "application/pdf" }],
    uploaded_by: "teacher@avantifellows.org",
    uploaded_at: "2026-11-25T10:00:00.000Z",
  };
  const jeeBoth: StudentExamRecord = {
    ...storedJee,
    has_password: false,
    sessions_applied: [1, 2],
    acknowledgements: [ack],
  };

  function serveWithAcks(records: StudentExamRecord[], available = true) {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        exams: EXAMS,
        records,
        can_reveal_password: false,
        acknowledgements_available: available,
      }),
    );
  }

  async function open(records: StudentExamRecord[], available = true, boardStream = "PCM") {
    serveWithAcks(records, available);
    render(<ExamsTab studentId={7} boardStream={boardStream} onSaved={vi.fn()} />);
    await screen.findByLabelText("Add exam");
  }

  it("gives JEE Mains one slot per saved session, with the stored acknowledgement", async () => {
    await open([jeeBoth]);

    const s1 = screen.getByTestId("ack-slot-10-1");
    const s2 = screen.getByTestId("ack-slot-10-2");
    expect(within(s1).getByText("Session 1 exam acknowledgement")).toBeInTheDocument();
    expect(
      within(s1).getByRole("button", { name: "Upload JEE Mains session 1 exam acknowledgement" }),
    ).toBeInTheDocument();
    expect(within(s2).getByRole("link", { name: /^Open JEE Mains session [12] exam acknowledgement$/ })).toHaveAttribute(
      "href",
      "/api/students/7/documents/501/page/1",
    );
    expect(
      within(s2).getByRole("button", { name: "Replace JEE Mains session 2 exam acknowledgement" }),
    ).toBeInTheDocument();
  });

  it("gives an exam without sessions a single slot", async () => {
    await open([
      { ...storedJee, id: 11, exam_id: 2, exam_name: "NEET", sessions_applied: null },
    ], true, "PCB");

    expect(within(screen.getByTestId("ack-slot-11-single")).getByText("Exam acknowledgement"))
      .toBeInTheDocument();
  });

  it("asks for a save before an unsaved exam can take an upload", async () => {
    await open([]);
    expect(
      screen.getByText("Save this exam to upload its exam acknowledgement."),
    ).toBeInTheDocument();
  });

  it("asks for a saved session before JEE Mains can take an upload", async () => {
    await open([{ ...storedJee, sessions_applied: null }]);
    expect(
      screen.getByText("Tick a session and save to upload its exam acknowledgement."),
    ).toBeInTheDocument();
  });

  it("offers no uploads while acknowledgements can't be read", async () => {
    await open([jeeBoth], false);
    expect(screen.queryByText("Exam acknowledgement")).not.toBeInTheDocument();
  });

  it("warns that unticking a session removes its acknowledgement", async () => {
    const user = userEvent.setup();
    await open([jeeBoth]);

    await user.click(screen.getByLabelText("Session 2"));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saving will also remove: JEE Mains session 2 exam acknowledgement.",
    );
  });

  it("warns that removing an exam removes its acknowledgements", async () => {
    const user = userEvent.setup();
    await open([jeeBoth]);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saving will also remove: JEE Mains session 2 exam acknowledgement.",
    );
  });

  it("uploads a PDF for a session and shows it without a save", async () => {
    const user = userEvent.setup();
    await open([{ ...jeeBoth, acknowledgements: [] }]);
    const stored = { ...ack, id: 601, exam_session: 1 };
    mockFetch.mockResolvedValueOnce(jsonResponse(stored, 201));

    const slot = screen.getByTestId("ack-slot-10-1");
    await user.upload(
      within(slot).getByLabelText("Choose JEE Mains session 1 exam acknowledgement file"),
      new File(["%PDF"], "confirmation.pdf", { type: "application/pdf" }),
    );
    await user.click(
      within(slot).getByRole("button", { name: "Save JEE Mains session 1 exam acknowledgement" }),
    );

    await waitFor(() =>
      expect(within(slot).getByRole("link", { name: /^Open JEE Mains session [12] exam acknowledgement$/ })).toHaveAttribute(
        "href",
        "/api/students/7/documents/601/page/1",
      ),
    );
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("/api/students/7/exam-records/10/acknowledgement");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("exam_session")).toBe("1");
    expect((init.body as FormData).get("page_1")).toBeInstanceOf(Blob);
    expect(mockFetch.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
  });

  it("removes an acknowledgement after a confirm", async () => {
    const user = userEvent.setup();
    await open([jeeBoth]);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const slot = screen.getByTestId("ack-slot-10-2");
    await user.click(
      within(slot).getByRole("button", { name: "Remove JEE Mains session 2 exam acknowledgement" }),
    );
    await user.click(
      within(slot).getByRole("button", {
        name: "Confirm removing JEE Mains session 2 exam acknowledgement",
      }),
    );

    await waitFor(() =>
      expect(
        within(slot).getByRole("button", { name: "Upload JEE Mains session 2 exam acknowledgement" }),
      ).toBeInTheDocument(),
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "/api/students/7/exam-records/10/acknowledgement?document_id=501",
    );
    expect(mockFetch.mock.calls[1][1].method).toBe("DELETE");
  });
});
