import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { TeamLeadsManager } from "./TeamLeadsManager";

const LEAD = { userId: 78, name: "Synthetic Lead", email: "lead@test.local" };
const REPORTEE = { userId: 77, name: "Synthetic Reportee", email: "reportee@test.local" };
const OTHER = { userId: 79, name: "Synthetic Other", email: "other@test.local" };
const LINK = {
  id: 4,
  teamLead: { ...LEAD, isMentor: true },
  reportee: { ...REPORTEE, isMentor: true },
  startedOn: "2026-11-12",
  endsOn: null,
};

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
    expect(row).not.toHaveTextContent("ending on");

    rerender(<TeamLeadsManager links={[]} mentors={[LEAD, REPORTEE]} />);
    expect(screen.getByText("No team leads yet.")).toBeInTheDocument();
  });

  it("shows when a link given a future end stops, and End cuts it short", async () => {
    const user = userEvent.setup();
    const ending = { ...LINK, endsOn: "2026-12-31" };
    render(<TeamLeadsManager links={[ending]} mentors={[LEAD, REPORTEE]} />);

    const row = within(screen.getByRole("list", { name: "Team leads" })).getByRole("listitem");
    expect(row).toHaveTextContent("Since 12 Nov 2026 · ending on 31 Dec 2026");

    await user.click(within(row).getByRole("button", { name: "End Synthetic Lead → Synthetic Reportee" }));
    const dialog = screen.getByRole("dialog", { name: "End this team lead?" });
    expect(dialog).toHaveTextContent(
      "Synthetic Lead will no longer see Synthetic Reportee's students from now, instead of from 31 Dec 2026. The record is kept."
    );
    respond(204);
    await user.click(within(dialog).getByRole("button", { name: "End" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/blended-learning/team-leads/4/end", expect.objectContaining({ method: "POST" }));
  });

  it("says nothing extra about a link whose two people are both still Mentors", () => {
    render(<TeamLeadsManager links={[LINK]} mentors={[LEAD, REPORTEE]} />);
    expect(screen.queryByText(/no longer a mentor/)).not.toBeInTheDocument();
  });

  it("notes a link whose reportee, lead, or both are no longer Mentors, and still ends it", async () => {
    const user = userEvent.setup();
    const reporteeGone = { ...LINK, reportee: { ...REPORTEE, isMentor: false } };
    const leadGone = { ...LINK, id: 5, teamLead: { ...LEAD, isMentor: false }, reportee: { ...OTHER, isMentor: true } };
    const bothGone = {
      id: 6,
      teamLead: { ...OTHER, isMentor: false },
      reportee: { userId: 83, name: "Synthetic Departed", email: null, isMentor: false },
      startedOn: "2026-11-13",
      endsOn: null,
    };
    render(<TeamLeadsManager links={[reporteeGone, leadGone, bothGone]} mentors={[LEAD, REPORTEE, OTHER]} />);

    const rows = within(screen.getByRole("list", { name: "Team leads" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Synthetic Reportee is no longer a mentor, so this link has no effect.");
    expect(rows[1]).toHaveTextContent("Synthetic Lead is no longer a mentor, so this link has no effect.");
    expect(rows[2]).toHaveTextContent(
      "Synthetic Other and Synthetic Departed are no longer mentors, so this link has no effect."
    );

    await user.click(within(rows[0]).getByRole("button", { name: "End Synthetic Lead → Synthetic Reportee" }));
    const dialog = screen.getByRole("dialog", { name: "End this team lead?" });
    expect(dialog).toHaveTextContent(
      "Synthetic Reportee is no longer a mentor, so this link has no effect. Ending it changes no one's access."
    );
    respond(204);
    await user.click(within(dialog).getByRole("button", { name: "End" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/blended-learning/team-leads/4/end", expect.objectContaining({ method: "POST" }));
    expect(mockRefresh).toHaveBeenCalled();
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

  it("shows emails only for Mentors who share a display name, in the dropdowns, the list and the confirmation", async () => {
    const user = userEvent.setup();
    const twinA = { userId: 80, name: "Synthetic Twin", email: "twin.a@test.local" };
    const twinB = { userId: 81, name: "Synthetic Twin", email: "twin.b@test.local" };
    const link = { id: 5, teamLead: { ...LEAD, isMentor: true }, reportee: { ...twinA, isMentor: true }, startedOn: "2026-11-12", endsOn: null };
    render(<TeamLeadsManager links={[link]} mentors={[LEAD, twinA, twinB]} />);

    const form = screen.getByRole("form", { name: "Add a team lead" });
    expect(within(within(form).getByLabelText("Team lead")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a mentor",
      "Synthetic Lead",
      "Synthetic Twin (twin.a@test.local)",
      "Synthetic Twin (twin.b@test.local)",
    ]);
    const row = within(screen.getByRole("list", { name: "Team leads" })).getByRole("listitem");
    expect(row).toHaveTextContent("Synthetic LeadleadsSynthetic Twin (twin.a@test.local)");

    await user.click(screen.getByRole("button", { name: "End Synthetic Lead → Synthetic Twin (twin.a@test.local)" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Synthetic Lead will no longer see Synthetic Twin (twin.a@test.local)'s students."
    );
  });

  it("counts a same-name Mentor who is only in a saved link (no longer an option)", () => {
    const departed = { userId: 82, name: "Synthetic Reportee", email: "departed@test.local", isMentor: false };
    render(
      <TeamLeadsManager
        links={[{ id: 6, teamLead: { ...LEAD, isMentor: true }, reportee: departed, startedOn: "2026-11-12", endsOn: null }]}
        mentors={[LEAD, REPORTEE]}
      />
    );

    expect(within(screen.getByRole("list", { name: "Team leads" })).getByRole("listitem")).toHaveTextContent(
      "Synthetic Reportee (departed@test.local)"
    );
    expect(screen.getAllByRole("option", { name: "Synthetic Reportee (reportee@test.local)" })).toHaveLength(2);
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
