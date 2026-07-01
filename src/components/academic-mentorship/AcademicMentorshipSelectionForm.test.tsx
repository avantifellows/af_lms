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
  programSchoolLinks: [
    { programId: 1, schoolId: 20 },
    { programId: 64, schoolId: 21 },
  ],
  schools: [
    { id: 20, code: "59525", name: "JNV Adilabad", region: "Telangana" },
    { id: 21, code: "24701", name: "JNV Chandigarh", region: "Chandigarh" },
  ],
};

describe("AcademicMentorshipSelectionForm", () => {
  it("filters School options and resets School when Program changes", async () => {
    const user = userEvent.setup();

    render(<AcademicMentorshipSelectionForm {...props} />);

    expect(screen.getByLabelText("School")).toHaveValue("59525");
    await user.selectOptions(screen.getByLabelText("Program"), "1");

    expect(screen.getByLabelText("School")).toHaveValue("");
    expect(screen.getByRole("option", { name: "JNV Adilabad (59525)" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "JNV Chandigarh (24701)" })
    ).not.toBeInTheDocument();
  });
});
