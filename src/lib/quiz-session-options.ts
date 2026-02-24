export interface Option {
  value: string;
  label: string;
}

export const TestTypeOptions: Option[] = [
  { value: "assessment", label: "Assessment" },
  { value: "homework", label: "Homework" },
  { value: "form", label: "Form" },
  { value: "omr-assessment", label: "OMR Assessment" },
];

export const TestFormatOptions: Option[] = [
  { value: "part_test", label: "Part Test" },
  { value: "major_test", label: "Major Test" },
  { value: "chapter_test", label: "Chapter Test" },
  { value: "combined_chapter_test", label: "Combined Chapter Test" },
  { value: "full_syllabus_test", label: "Full Syllabus Test" },
  { value: "evaluation_test", label: "Evaluation Test" },
  { value: "hiring_test", label: "Hiring Test" },
  { value: "mock_test", label: "Mock Test" },
  { value: "homework", label: "Homework" },
  { value: "questionnaire", label: "Questionnaire" },
];

export const TestPurposeOptions: Option[] = [
  { value: "baseline", label: "Baseline" },
  { value: "endline", label: "Endline" },
  { value: "weekly_test", label: "Weekly Test" },
  { value: "monthly_test", label: "Monthly Test" },
  { value: "reshuffling_test", label: "Reshuffling Test" },
  { value: "selection_test", label: "Selection Test" },
  { value: "one_time", label: "One Time Test" },
  { value: "practice_test", label: "Practice Test" },
  { value: "class_hw", label: "Class Homework" },
  { value: "assignment", label: "Assignment" },
];

export const CourseOptions: Option[] = [
  { value: "NEET", label: "NEET" },
  { value: "Catalyst", label: "Catalyst" },
  { value: "Alpha", label: "Alpha" },
  { value: "Hiring", label: "Hiring" },
  { value: "Certification", label: "Certification" },
  { value: "Foundation", label: "Foundation" },
  { value: "Photon", label: "Photon" },
  { value: "JEE", label: "JEE" },
  { value: "CUET", label: "CUET" },
  { value: "CA", label: "CA" },
  { value: "CLAT", label: "CLAT" },
];

export const StreamOptions: Option[] = [
  { value: "engineering", label: "Engineering" },
  { value: "medical", label: "Medical" },
  { value: "maths", label: "Maths" },
  { value: "science", label: "Science" },
  { value: "maths_science", label: "Maths Science" },
  { value: "physics", label: "Physics" },
  { value: "chemistry", label: "Chemistry" },
  { value: "biology", label: "Biology" },
  { value: "pcmb", label: "PCMB" },
  { value: "botany", label: "Botany" },
  { value: "zoology", label: "Zoology" },
  { value: "pcmba", label: "PCMBA" },
  { value: "tbd", label: "TBD" },
  { value: "business_studies", label: "Business Studies" },
  { value: "economics", label: "Economics" },
  { value: "nda", label: "NDA" },
  { value: "Others", label: "Others" },
  { value: "ca", label: "CA" },
  { value: "clat", label: "CLAT" },
];

export const OptionalLimitOptions: Option[] = [
  { value: "N/A", label: "N/A" },
  { value: "NEET", label: "NEET" },
  { value: "JEE", label: "JEE" },
  { value: "CUET", label: "CUET" },
  { value: "NA", label: "NA" },
];

export const GradeOptions: Option[] = [
  { value: "10", label: "10" },
  { value: "11", label: "11" },
  { value: "12", label: "12" },
];
