import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherMappingWorkspace from "./TeacherMappingWorkspace";

describe("TeacherMappingWorkspace", () => {
  beforeEach(() => sessionStorage.clear());

  it("claims the selected current roster facts and refreshes immediately", async () => {
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
    expect(await screen.findByText("No eligible Students to show yet.")).toBeInTheDocument();
  });
});
