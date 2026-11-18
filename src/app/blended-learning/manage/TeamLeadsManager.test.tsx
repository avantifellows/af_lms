import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { TeamLeadsManager } from "./TeamLeadsManager";

const LEAD = { userId: 78, name: "Synthetic Lead" };
const REPORTEE = { userId: 77, name: "Synthetic Reportee" };
const OTHER = { userId: 79, name: "Synthetic Other" };
const LINK = { id: 4, teamLead: LEAD, reportee: REPORTEE, startedOn: "2026-11-12" };

let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamLeadsManager", () => {
  it("lists who leads whom since when, or says there are none", () => {
    const { rerender } = render(<TeamLeadsManager links={[LINK]} mentors={[LEAD, REPORTEE]} />);
    const row = within(screen.getByRole("list", { name: "Team leads" })).getByRole("listitem");
    expect(row).toHaveTextContent("Synthetic LeadleadsSynthetic Reportee");
    expect(row).toHaveTextContent("Since 12 Nov 2026");

    rerender(<TeamLeadsManager links={[]} mentors={[LEAD, REPORTEE]} />);
    expect(screen.getByText("No team leads yet.")).toBeInTheDocument();
  });

  it("adds a team lead and the Mentor they lead, then re-reads the page", async () => {
    const user = userEvent.setup();
    render(<TeamLeadsManager links={[]} mentors={[LEAD, REPORTEE, OTHER]} />);
    respond(201);

    const form = screen.getByRole("form", { name: "Add a team lead" });
    await user.selectOptions(within(form).getByLabelText("Team lead"), "Synthetic Lead");
    await user.selectOptions(within(form).getByLabelText("Mentor they lead"), "Synthetic Reportee");
    await user.click(within(form).getByRole("button", { name: "Add team lead" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blended-learning/team-leads",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ supervisorUserId: "78", mentorUserId: "77" }) })
    );
    expect(mockRefresh).toHaveBeenCalled();
    expect(within(form).getByLabelText("Team lead")).toHaveValue("");
  });

  it("shows the field errors, or the error, the server sends back", async () => {
    const user = userEvent.setup();
    render(<TeamLeadsManager links={[]} mentors={[LEAD, REPORTEE]} />);
    const form = screen.getByRole("form", { name: "Add a team lead" });

    respond(422, { error: "Choose a team lead.", fieldErrors: { supervisorUserId: "Choose a team lead." } });
    await user.click(within(form).getByRole("button", { name: "Add team lead" }));
    expect(within(form).getByLabelText("Team lead")).toHaveAccessibleDescription("Choose a team lead.");

    respond(409, { error: "This team lead already leads this mentor." });
    await user.click(within(form).getByRole("button", { name: "Add team lead" }));
    expect(within(form).getByText("This team lead already leads this mentor.")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("ends one after a confirmation, and keeps the dialog open with the error when it fails", async () => {
    const user = userEvent.setup();
    render(<TeamLeadsManager links={[LINK]} mentors={[LEAD, REPORTEE]} />);

    await user.click(screen.getByRole("button", { name: "End Synthetic Lead → Synthetic Reportee" }));
    const dialog = screen.getByRole("dialog", { name: "End this team lead?" });
    expect(dialog).toHaveTextContent("Synthetic Lead will no longer see Synthetic Reportee's students.");

    respond(404, { error: "Not found" });
    await user.click(within(dialog).getByRole("button", { name: "End" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Not found");

    respond(204);
    await user.click(within(dialog).getByRole("button", { name: "End" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/blended-learning/team-leads/4/end", expect.objectContaining({ method: "POST" }));
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the dialog on Cancel without ending", async () => {
    const user = userEvent.setup();
    render(<TeamLeadsManager links={[LINK]} mentors={[LEAD, REPORTEE]} />);

    await user.click(screen.getByRole("button", { name: "End Synthetic Lead → Synthetic Reportee" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
