// Field definitions shared by the form (browser) and validation (server).
// No server-only imports here.

/** Case-insensitive answer, so old records' spellings ("YES", "Gap year") count too. */
export const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** Dropdown values. Alumni ones are the real values in dim_alumni / dim_degree /
 *  dim_job_sector (BigQuery, 2026-09-21). */
export const ENUMS: Record<string, readonly string[]> = {
  contact_status: ["Contacted - Negative Response", "Contacted - Positive Response", "Contacted - Unreachable", "No - Other", "Not Contacted"],
  current_status: ["Demise", "Discontinued Studies", "Employed", "Gap Year", "Married", "No Data", "Preparing For PG/Govt Job", "Seeking Work", "Studying"],
  employment_status: ["Employed - Full-time", "Employed - Internship", "Not Employed", "Not Employed - Not Seeking Work", "Not Employed - Seeking Work"],
  ug_status: ["Studying", "Graduated", "Discontinued Studies", "Gap Year", "Update Data"],
  pg_status: ["Studying", "Graduated", "Applying", "Not Applying"],
  did_you_take_a_gap_year: ["No", "Yes"],
  current_ctc_range: ["< INR 1 LPA", "INR 1 to 3 LPA", "INR 3 to 6 LPA", "INR 6 to 9 LPA", "INR 9 to 12 LPA", "> INR 12 LPA"],
  starting_ctc_ug_range: ["< INR 1 LPA", "INR 1 to 3 LPA", "INR 3 to 6 LPA", "INR 6 to 9 LPA", "INR 9 to 12 LPA", "> INR 12 LPA"],
  which_competitive_exam_did_you_appear_for: ["JEE", "NEET", "CUET", "Common University Entrance Test (CUET)", "CLAT", "State CET", "KCET", "MHT CET", "HPCET", "IPU", "JAC", "JOSAA", "NDA", "Govt", "Taking Drop Year", "NA", "Other"],
  why_did_you_take_a_gap_year: ["To score well and get better college", "Did not get target college/course", "Low Rank/Low Marks", "Could not pay college fees", "Due to Health Issues", "Family pressure", "Marriage", "Started working"],
  current_job_sector: ["IT", "IT/Software", "Data Science", "Core", "Core Engineering", "Manufacturing", "Steel Core", "Financial Services", "Non Tech", "Consulting", "Sales/Marketing", "HR", "Hospitality", "Medical", "Pharma", "Veterinary", "Education", "Teaching", "Research", "Agriculture", "Architecture", "Business", "Entrepreneurship", "Media", "Social Impact", "Social Media", "Supply Chain", "Textile", "Job", "Govt. - Administrative", "Govt. - Engineering", "Govt. - Financial Services", "Govt. - Fire Department", "Govt. - IT/Software", "Govt. - Medical", "Govt. - Military", "Govt.- Defence", "Govt. - Police", "Govt. - Postal Services", "Govt. - Railways", "Govt. - Sericulture", "Govt. - Other", "Other - Internship", "Other"],
  degree_ug: ["BTech/BE", "BTech/MTech", "BSc", "BSc/MSc", "BS", "BS/MS", "BStat", "MBBS", "BDS", "BAMS", "BHMS", "BNYS", "BPT", "BPharm", "Pharm D", "DPharm", "BVSc", "BHM", "Other - Medical", "BArch", "BDes", "BCA", "BBA", "BCom", "BA", "BA LLB", "BA/BEd", "BSc/BEd", "Diploma - Engg", "Diploma - Medical", "Vocational Course", "Techbee", "Other-Govt/Army/Navy", "Drop", "Other"],
  // PG degrees actually used in dim_alumni.degree_pg (2026-10-06).
  degree_pg: ["MTech", "MS", "MSc", "MCA", "MBA", "MA", "MCom", "BEd", "MD", "MS (Surgery)", "MDS", "MPharm", "MDes", "LLB", "MLLM", "MPhil", "PhD", "Other"],
  scholarship_availed: ["Yes", "No"],
};

export type FieldType = "enum" | "year" | "number" | "text" | "college" | "branch";
export type Values = Record<string, string>;
type Rule = (v: Values) => boolean;

export interface FieldDef {
  column: string;
  label: string;
  type: FieldType;
  hint?: string;
  /** Show only when this is true (a field that already has a value always shows). */
  showWhen?: Rule;
  /** The answers `showWhen` reads — a value is only flagged as stale once one of these is filled. */
  dependsOn?: string[];
}

export interface SectionDef {
  id: string;
  title: string;
  description?: string;
  showWhen?: Rule;
  dependsOn?: string[];
  collapsed?: boolean;
  fields: FieldDef[];
}

const UG_IN_COLLEGE = ["Studying", "Graduated", "Discontinued Studies"];
const PG_IN_COLLEGE = ["Studying", "Graduated"];
export const isEmployed = (v: Values) => (v.employment_status || "").startsWith("Employed");
const ugGraduated = (v: Values) => v.ug_status === "Graduated";

/**
 * The alumni form, in order. Sections and fields appear as answers make them
 * relevant (e.g. PG only after UG = Graduated, Work only when employed).
 */
export const ALUMNI_SECTIONS: SectionDef[] = [
  {
    id: "status",
    title: "Where are they now?",
    description: "Start here — the sections below open based on these answers.",
    fields: [
      { column: "contact_status", label: "Contact status", type: "enum" },
      { column: "current_status", label: "Current status", type: "enum" },
      { column: "ug_status", label: "Undergraduate (UG) status", type: "enum" },
      { column: "employment_status", label: "Employment", type: "enum" },
      { column: "did_you_take_a_gap_year", label: "Took a gap year?", type: "enum" },
      {
        column: "why_did_you_take_a_gap_year", label: "Gap year reason", type: "enum",
        // Case-insensitive, like checks.ts, so old records' "YES" / "Gap year" show it too.
        showWhen: (v) => lower(v.did_you_take_a_gap_year) === "yes" || lower(v.ug_status) === "gap year",
        dependsOn: ["did_you_take_a_gap_year", "ug_status"],
      },
      { column: "which_competitive_exam_did_you_appear_for", label: "Admission through exam", type: "enum" },
    ],
  },
  {
    id: "ug",
    title: "Undergraduate (UG)",
    showWhen: (v) => UG_IN_COLLEGE.includes(v.ug_status),
    dependsOn: ["ug_status"],
    fields: [
      { column: "college_id_ug", label: "College", type: "college" },
      { column: "branch_id_ug", label: "Branch", type: "branch" },
      { column: "degree_ug", label: "Degree", type: "enum" },
      { column: "start_year_ug", label: "Start year", type: "year" },
      { column: "year_of_graduation_ug", label: "Graduation year", type: "year", showWhen: ugGraduated, dependsOn: ["ug_status"] },
    ],
  },
  {
    id: "pg",
    title: "Postgraduate (PG)",
    description: "Only for students who have finished UG.",
    showWhen: ugGraduated,
    dependsOn: ["ug_status"],
    fields: [
      { column: "pg_status", label: "PG status", type: "enum" },
      { column: "college_id_pg", label: "College", type: "college", showWhen: (v) => PG_IN_COLLEGE.includes(v.pg_status), dependsOn: ["pg_status"] },
      { column: "branch_id_pg", label: "Branch", type: "branch", showWhen: (v) => PG_IN_COLLEGE.includes(v.pg_status), dependsOn: ["pg_status"] },
      { column: "degree_pg", label: "Degree", type: "enum", showWhen: (v) => PG_IN_COLLEGE.includes(v.pg_status), dependsOn: ["pg_status"] },
      { column: "start_year_pg", label: "Start year", type: "year", showWhen: (v) => PG_IN_COLLEGE.includes(v.pg_status), dependsOn: ["pg_status"] },
      { column: "year_of_graduation_pg", label: "Graduation year", type: "year", showWhen: (v) => v.pg_status === "Graduated", dependsOn: ["pg_status"] },
    ],
  },
  {
    id: "work",
    title: "Work",
    showWhen: isEmployed,
    dependsOn: ["employment_status"],
    fields: [
      { column: "current_org_name", label: "Organisation", type: "text" },
      { column: "current_job_role", label: "Job role", type: "text" },
      { column: "current_job_city", label: "Job city", type: "text" },
      { column: "current_job_sector", label: "Job sector", type: "enum" },
      { column: "current_ctc", label: "Current CTC (INR / year)", type: "number" },
      { column: "current_ctc_range", label: "Current CTC range", type: "enum" },
      { column: "which_year_did_you_start_working", label: "Year started working", type: "year" },
      { column: "years_of_experience", label: "Years of experience", type: "number" },
      { column: "starting_ctc_ug_range", label: "Starting CTC after UG", type: "enum", showWhen: ugGraduated, dependsOn: ["ug_status"] },
      {
        column: "what_was_your_monthly_household_income_excluding_the_respondent_when_you_were_starting_your_first_job",
        label: "Monthly household income when starting first job (excl. student)", type: "text",
      },
    ],
  },
  {
    id: "more",
    title: "More details (optional)",
    collapsed: true,
    fields: [
      { column: "past_internship_orgs", label: "Past internships", type: "text" },
      { column: "linkedin_profile_link", label: "LinkedIn profile link", type: "text" },
      { column: "skilling_programs", label: "Skilling programs", type: "text" },
      { column: "scholarship_availed", label: "Scholarship availed", type: "enum" },
      {
        column: "if_avanti_was_not_your_only_source_of_test_prep_coaching_then_what_other_resources_did_you_opt_for",
        label: "Other test-prep resources (if Avanti wasn't the only one)", type: "text",
      },
    ],
  },
];

export const ALUMNI_FIELDS: FieldDef[] = ALUMNI_SECTIONS.flatMap((s) => s.fields);

/** A field is shown when its section and its own rule apply — or when it already holds a value. */
export function isFieldShown(section: SectionDef, field: FieldDef, v: Values): boolean {
  if (v[field.column]) return true;
  return (section.showWhen ? section.showWhen(v) : true) && (field.showWhen ? field.showWhen(v) : true);
}

/**
 * Shown only because it already holds a value, and the answers it depends on
 * (now filled in) say it shouldn't apply. Old records often have e.g. a UG
 * college but no UG status — that's not flagged until the status is set.
 */
export function isFieldStale(section: SectionDef, field: FieldDef, v: Values): boolean {
  if (!v[field.column]) return false;
  const deps = [...(section.dependsOn ?? []), ...(field.dependsOn ?? [])];
  if (deps.length && deps.every((d) => !v[d])) return false;
  return !((section.showWhen ? section.showWhen(v) : true) && (field.showWhen ? field.showWhen(v) : true));
}

/** Profile fields (read-only, from LMS student/user tables), grouped for display. */
export const PROFILE_GROUPS: { title: string; fields: [column: string, label: string][] }[] = [
  {
    title: "Student",
    fields: [
      ["user_first_name", "First name"], ["user_last_name", "Last name"], ["user_gender", "Gender"],
      ["user_date_of_birth", "Date of birth"], ["student_category", "Category"],
      ["student_physically_handicapped", "Physically handicapped"], ["student_apaar_id", "APAAR ID"],
      ["student_stream", "Stream"], ["student_board_stream", "Board stream"],
    ],
  },
  {
    title: "Contact",
    fields: [
      ["user_phone", "Phone"], ["user_whatsapp_phone", "WhatsApp"], ["user_email", "Email"],
      ["user_city", "City"], ["user_district", "District"], ["user_state", "State"], ["user_pincode", "Pincode"],
    ],
  },
  {
    title: "Family",
    fields: [
      ["student_father_name", "Father"], ["student_father_phone", "Father's phone"],
      ["student_father_education_level", "Father's education"], ["student_father_profession", "Father's profession"],
      ["student_mother_name", "Mother"], ["student_mother_phone", "Mother's phone"],
      ["student_mother_education_level", "Mother's education"], ["student_mother_profession", "Mother's profession"],
      ["student_annual_family_income", "Annual family income"], ["student_monthly_family_income", "Monthly family income"],
    ],
  },
];
