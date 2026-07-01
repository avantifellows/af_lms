import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AcademicMentorshipSelectionForm from "./AcademicMentorshipSelectionForm";

const props = {
  academicYears: ["2026-2027", "2025-2026"],
  selectedAcademicYear: "2026-2027",
  selectedSchoolCode: "59525",
  selectedProgramId: null,
  includeHistory: false,
  programs: [
    { id: 1, name: "JNV COE" },
    { id: 64, name: "JNV NVS" },
  ],
  schools: [
    { id: 20, code: "59525", name: "JNV Adilabad", region: "Telangana" },
  ],
};

describe("AcademicMentorshipSelectionForm", () => {
  it("resets School and submits when Program changes", async () => {
    const requestSubmit = vi.fn();
    HTMLFormElement.prototype.requestSubmit = requestSubmit;
    const user = userEvent.setup();

    render(<AcademicMentorshipSelectionForm {...props} />);

    expect(screen.getByLabelText("School")).toHaveValue("59525");
    await user.selectOptions(screen.getByLabelText("Program"), "1");

    expect(screen.getByLabelText("School")).toHaveValue("");
    expect(requestSubmit).toHaveBeenCalledOnce();
  });
});
