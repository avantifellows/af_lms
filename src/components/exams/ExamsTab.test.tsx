import { render, screen, waitFor, within } from "@testing-library/react";
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
function serve(records: StudentExamRecord[] = []) {
  mockFetch.mockResolvedValueOnce(jsonResponse({ exams: EXAMS, records }));
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
) {
  serve(records);
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
  application_password: "secret",
  sessions_applied: [1],
};

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

  it("masks a stored password until Show is pressed", async () => {
    const user = userEvent.setup();
    await renderTab({ boardStream: "PCM" }, [storedJee]);

    const password = screen.getByLabelText("Application password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveValue("secret");

    await user.click(screen.getByRole("button", { name: "Show JEE Mains password" }));

    expect(screen.getByLabelText("Application password")).toHaveAttribute("type", "text");
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
          application_password: "",
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
    mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
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
    mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));
    await user.click(screen.getByRole("button", { name: "Save Exams" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
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
