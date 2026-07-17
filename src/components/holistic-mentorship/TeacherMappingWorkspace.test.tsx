import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

describe("TeacherMappingWorkspace", () => {
  beforeEach(() => sessionStorage.clear());

  it("claims the selected current roster facts and refreshes immediately", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actorUserId: 9,
          students: [{
            studentId: 41,
            name: "Asha Rao",
            externalStudentId: "ST-41",
            grade: 11,
            ownership: null,
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, changed: 1 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorUserId: 9, students: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="assign" />);
    await user.click(await screen.findByRole("checkbox", { name: "Select Asha Rao" }));
    await user.click(screen.getByRole("button", { name: "Assign 1 selected" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [, request] = fetchMock.mock.calls[1];
    expect(request).toMatchObject({ method: "POST" });
    expect(JSON.parse(request.body)).toEqual({
      school_code: "SCH001",
      academic_year: "2026-2027",
      takeover_confirmed: false,
      selections: [{ student_id: 41, expected_mapping_id: null }],
    });
    expect(confirm).toHaveBeenCalledWith("Assign 1 Student to yourself?");
    expect(screen.getByRole("status")).toHaveTextContent("Assigned 1 Student to you.");
    expect(await screen.findByText("No eligible Students to show yet.")).toBeInTheDocument();
  });

  it("shows only available Students and filters them by assignment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actorUserId: 9,
        students: [
          { studentId: 41, name: "My Mentee", externalStudentId: "ST-41", grade: 11,
            ownership: { mappingId: 80, mentorUserId: 9, mentorName: "Me" } },
          { studentId: 42, name: "Available Student", externalStudentId: "ST-42", grade: 11,
            ownership: null },
          { studentId: 43, name: "Another Mentee", externalStudentId: "ST-43", grade: 12,
            ownership: { mappingId: 81, mentorUserId: 8, mentorName: "Nila Sen" } },
        ],
      }),
    }));
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="assign" />);

    expect(await screen.findByText("Available Student")).toBeInTheDocument();
    expect(screen.getByText("Another Mentee")).toBeInTheDocument();
    expect(screen.queryByText("My Mentee")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select Available Student" }));
    expect(screen.getByRole("button", { name: "Assign 1 selected" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by Assignment"), "unassigned");
    expect(await screen.findByText("Available Student")).toBeInTheDocument();
    expect(screen.queryByText("Another Mentee")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign 1 selected" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by Assignment"), "other");
    expect(await screen.findByText("Another Mentee")).toBeInTheDocument();
    expect(screen.queryByText("Available Student")).not.toBeInTheDocument();
  });

  it("names the current Mentor and count before a takeover", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actorUserId: 9,
        students: [{
          studentId: 43,
          name: "Another Mentee",
          externalStudentId: "ST-43",
          grade: 12,
          ownership: { mappingId: 81, mentorUserId: 8, mentorName: "Nila Sen" },
        }],
      }),
    }));
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="assign" />);
    await user.click(await screen.findByRole("checkbox", { name: "Select Another Mentee" }));
    await user.click(screen.getByRole("button", { name: "Assign 1 selected" }));

    expect(confirm).toHaveBeenCalledWith(
      "1 Student is currently assigned to Nila Sen. Assign all 1 Student to yourself?"
    );
  });

  it("opens a Mentee at the stable Active Phase identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actorUserId: 9,
        students: [{
          studentId: 41,
          name: "Asha Rao",
          externalStudentId: "ST-41",
          grade: 11,
          activePhaseId: 73,
          ownership: { mappingId: 81, mentorUserId: 9, mentorName: "Nila Sen" },
        }],
      }),
    }));

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="mentees" />);

    expect(await screen.findByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027"
    );
  });

  it("keeps a read-only Teacher's roster visible without Mapping controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actorUserId: 9,
        students: [
          {
            studentId: 41,
            name: "Asha Rao",
            externalStudentId: "ST-41",
            grade: 11,
            activePhaseId: 73,
            ownership: { mappingId: 81, mentorUserId: 9, mentorName: "Nila Sen" },
          },
          {
            studentId: 42,
            name: "Available Student",
            externalStudentId: "ST-42",
            grade: 11,
            activePhaseId: 73,
            ownership: null,
          },
        ],
      }),
    }));

    const { rerender } = render(
      <TeacherMappingWorkspace schoolCode="SCH001" view="assign" canEdit={false} />
    );
    expect(await screen.findByText("Available Student")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    rerender(<TeacherMappingWorkspace schoolCode="SCH001" view="mentees" canEdit={false} />);
    expect(await screen.findByRole("link", { name: "Open Asha Rao" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("warns about access loss and confirms a successful removal", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actorUserId: 9,
          students: [{
            studentId: 41,
            name: "Asha Rao",
            externalStudentId: "ST-41",
            grade: 11,
            activePhaseId: 73,
            ownership: { mappingId: 81, mentorUserId: 9, mentorName: "Nila Sen" },
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, changed: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ actorUserId: 9, students: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="mentees" />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledWith(
      "Remove Asha Rao from My Mentees? The Student will become unassigned and you will lose access to their Holistic Mentorship data."
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Removed Asha Rao. The Student is now unassigned."
    );
  });

  it("refreshes ownership and announces a stale Mapping conflict", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const available = {
      studentId: 41,
      name: "Asha Rao",
      externalStudentId: "ST-41",
      grade: 11,
      ownership: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorUserId: 9, students: [available] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Mapping ownership changed; review the refreshed roster" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actorUserId: 9,
          students: [{
            ...available,
            ownership: { mappingId: 82, mentorUserId: 8, mentorName: "Nila Sen" },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="assign" />);
    await user.click(await screen.findByRole("checkbox", { name: "Select Asha Rao" }));
    await user.click(screen.getByRole("button", { name: "Assign 1 selected" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mapping ownership changed; review the refreshed roster"
    );
    expect(screen.getByText("Nila Sen")).toBeInTheDocument();
  });

  it("reports a refresh failure instead of claiming stale success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actorUserId: 9,
          students: [{
            studentId: 41,
            name: "Asha Rao",
            externalStudentId: "ST-41",
            grade: 11,
            ownership: null,
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, changed: 1 }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unable to refresh the roster" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TeacherMappingWorkspace schoolCode="SCH001" view="assign" />);
    await user.click(await screen.findByRole("checkbox", { name: "Select Asha Rao" }));
    await user.click(screen.getByRole("button", { name: "Assign 1 selected" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to refresh the roster");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
