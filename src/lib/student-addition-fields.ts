import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

export const CBSE_BOARD = "CENTRAL BOARD OF SECONDARY EDUCATION";

export const G10_BOARD_OPTIONS = [
  "A LEVEL OF GENERAL CERTIFICATE OF EDUCATION, CAMBRIDGE UNIVERSITY (IGSE)",
  "ALIGARH MUSLIM UNIVERSITY, ALIGARH",
  "ANDHRA PRADESH BOARD OF INTERMEDIATE EDUCATION",
  "ANDHRA PRADESH OPEN SCHOOL SOCIETY",
  "ASSAM HIGHER SECONDARY EDUCATION COUNCIL",
  "BANASTHALI VIDYAPEETH, RAJASTHAN",
  "BHARTIYA SHIKSHA BOARD, NOIDA",
  "BHUTAN HIGHER SECONDARY EDUCATION CERTIFICATE",
  "BIHAR BOARD OF OPEN SCHOOLING EXAMINATION",
  "BIHAR INTERMEDIATE EDUCATION COUNCIL (BIHAR SCHOOL EXAMINATION BOARD)",
  "Board of Open Schooling and Skill Education, Sikkim",
  "BOARD OF SECONDARY EDUCATION ANDHRA PRADESH",
  "BOARD OF SECONDARY EDUCATION ASSAM",
  "BOARD OF SECONDARY EDUCATION, TELANGANA STATE",
  "CBSE i (CBSE international)",
  CBSE_BOARD,
  "CENTRAL INSTITUTE OF BUDDHIST STUDIES (DEEMED UNIVERSITY)",
  "CHATTISGARH MADHYAMIK SHIKSHA MANDAL (CHHATTISGARH BOARD OF SECONDARY EDUCATION)",
  "CHHATTISGARH STATE OPEN SCHOOL",
  "COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS",
  "Dayalbagh Educational Institute, Agra",
  "DELHI BOARD OF SCHOOL EDUCATION",
  "EDEXCEL, LONDON (UK)",
  "FOREIGN",
  "GOA BOARD OF SECONDARY AND HIGHER SECONDARY EDUCATION",
  "GUJARAT SECONDARY AND HIGHER SECONDARY EDUCATION BOARD",
  "GURUKULA KANGRI VISWAVIDYALAYA",
  "H P BOARD OF SCHOOL EDUCATION",
  "HARYANA BOARD OF EDUCATION",
  "HARYANA OPEN SCHOOL, BHIWANI",
  "HIGHER SECONDARY EDUCATION BOARD, NEPAL",
  "INTERNATIONAL BACCALAUREATE",
  "INTERNATIONAL GENERAL CERTIFICATE OF SECONDARY EDUCATION",
  "J AND K STATE BOARD OF SCHOOL EDUCATION",
  "JAMIA MILIA ISLAMIA, NEW DELHI",
  "JHARKHAND ACADEMIC COUNCIL",
  "JHARKHAND STATE OPEN SCHOOL",
  "KARNATAKA BOARD OF PRE UNIVERSITY EDUCATION (KAR SEC EDU EXAM BOARD)",
  "KERALA BOARD OF HIGHER SECONDARY EDUCATION",
  "KERALA BOARD OF PUBLIC EXAMINATIONS",
  "M P STATE OPEN SCHOOL, BHOPAL",
  "MADHYA PRADESH BOARD OF SECONDARY EDUCATION",
  "MAHARASTRA STATE BOARD OF SECONDARY AND HIGHER SECONDARY EDUCATION",
  "MANIPUR COUNCIL OF HIGHER SECONDARY EDUCATION",
  "MEGHALAYA BOARD OF SECONDARY EDUCATION",
  "MIZORAM BOARD OF SCHOOL EDUCATION",
  "NAGALAND BOARD OF SCHOOL EDUCATION",
  "NATIONAL INSTITUTE OF OPEN SCHOOLING",
  "ODISHA COUNCIL OF HIGHER SECONDARY EDUCATION (BOARD OF SEC EDU ODISHA)",
  "PUNJAB SCHOOL EDUCATION BOARD",
  "RAJASTHAN BOARD OF SECONDARY EDUCATION",
  "RAJASTHAN STATE OPEN SCHOOL, JAIPUR",
  "RAJIV GANDHI UNIVERSITY OF KNOWLEDGE TECHNOLOGIES ( RGUKT)",
  "RASHTRIYA SANSKRIT SANSTHAN NEW DELHI (DEEMED UNIVERSITY)",
  "TAMIL NADU BOARD OF HIGHER SECONDARY EDUCATION",
  "TELANGANA OPEN SCHOOL SOCIETY",
  "TELANGANA STATE BOARD OF INTERMEDIATE EDUCATION",
  "TRIPURA BOARD OF SECONDARY EDUCATION",
  "U P BOARD OF HIGH SCHOOL AND INTERMEDIATE EDUCATION",
  "UP BOARD OF MADRASA EDUCATION LUCKNOW",
  "URDU EDUCATION BOARD DELHI",
  "UTTARAKHAND BOARD SECONDARY EDUCATION",
  "UTTARANCHAL SHIKSHA EVAM PARIKSHA PARISHAD",
  "WEST BENGAL BOARD OF SECONDARY EDUCATION",
  "WEST BENGAL COUNCIL OF HIGHER SECONDARY EDUCATION",
  "WEST BENGAL COUNCIL OF RABINDRA OPEN SCHOOLING",
] as const;

export const GENDER_OPTIONS = ["Female", "Male", "Others"] as const;
export const CATEGORY_OPTIONS = ["Gen", "Gen-EWS", "OBC", "SC", "ST"] as const;
export const BOARD_STREAM_OPTIONS = [
  "PCM",
  "PCB",
  "PCMB",
  "Commerce (Math)",
  "Commerce (Without Math)",
  "Arts/Humanities",
] as const;
export const STREAM_OPTIONS = ["Engineering", "Medical", "CA", "CLAT"] as const;
export const ANNUAL_FAMILY_INCOME_OPTIONS = [
  "Less than Rs. 1,00,000",
  "Rs. 1,00,000-2,00,000",
  "Rs. 2,00,000-3,00,000",
  "Rs. 3,00,000-4,00,000",
  "Rs. 4,00,000-5,00,000",
  "Rs. 5,00,000-6,00,000",
  "Rs. 6,00,000-7,00,000",
  "Rs. 7,00,000-8,00,000",
  "More than Rs. 8,00,000",
] as const;

const BOARD_SET = new Set<string>(G10_BOARD_OPTIONS);
const GENDER_SET = new Set<string>(GENDER_OPTIONS);
const CATEGORY_SET = new Set<string>(CATEGORY_OPTIONS);
const BOARD_STREAM_SET = new Set<string>(BOARD_STREAM_OPTIONS);
const INCOME_SET = new Set<string>(ANNUAL_FAMILY_INCOME_OPTIONS);
const STREAM_MAP: Record<string, LmsStudentStream> = {
  engineering: "engineering",
  medical: "medical",
  ca: "ca",
  clat: "clat",
};

export type LmsStudentStream = "engineering" | "medical" | "ca" | "clat";

export interface StudentAdditionInput {
  grade?: unknown;
  student_name?: unknown;
  date_of_birth?: unknown;
  gender?: unknown;
  category?: unknown;
  physically_handicapped?: unknown;
  apaar_id?: unknown;
  g10_board?: unknown;
  g10_roll_no?: unknown;
  board_stream?: unknown;
  stream?: unknown;
  father_name?: unknown;
  phone?: unknown;
  annual_family_income?: unknown;
}

export const STUDENT_ADDITION_UPLOAD_COLUMNS: ReadonlyArray<{
  label: string;
  key: keyof StudentAdditionInput;
}> = [
  { label: "Grade", key: "grade" },
  { label: "Student Name", key: "student_name" },
  { label: "Date of Birth", key: "date_of_birth" },
  { label: "Gender", key: "gender" },
  { label: "Category", key: "category" },
  { label: "Physical Handicapped / Vikalang", key: "physically_handicapped" },
  { label: "APAAR ID", key: "apaar_id" },
  { label: "G10 board", key: "g10_board" },
  { label: "Grade 10 Roll no", key: "g10_roll_no" },
  { label: "Board Stream", key: "board_stream" },
  { label: "Primary Exam preparing for", key: "stream" },
  { label: "Father Name", key: "father_name" },
  { label: "Parents Phone Number", key: "phone" },
  { label: "Yearly / Annual Family Income", key: "annual_family_income" },
] as const;

const UPLOAD_FIELD_LABELS = new Map(
  STUDENT_ADDITION_UPLOAD_COLUMNS.map((column) => [column.key, column.label]),
);

export interface StudentAdditionCsvResult {
  row_number?: number;
  status?: string;
  original?: Record<string, unknown>;
  field_errors?: Record<string, string>;
  row_errors?: string[];
  existing_match?: Record<string, unknown> | null;
}

type ExistingMatch = Record<string, unknown>;

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function matchText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// fallow-ignore-next-line complexity
export function formatStudentAdditionExistingMatch(
  existing: ExistingMatch | null | undefined,
  schoolCode?: string,
): string {
  const match = existing ?? {};
  const studentId = matchText(match.student_id) || "blank";
  const matchSchoolCode = matchText(match.school_code);

  if (schoolCode && (!matchSchoolCode || matchSchoolCode === schoolCode)) {
    return `This student is already part of this school. Student ID: ${studentId}.`;
  }
  if (!matchSchoolCode) {
    return `This student already exists. Student ID: ${studentId}.`;
  }

  const schoolName = matchText(match.school_name) || "another school";
  const udise = matchText(match.udise_code);
  const location = [matchText(match.district), matchText(match.state)].filter(Boolean).join(", ");
  const identifiers = [
    `Student ID: ${studentId}`,
    matchText(match.apaar_id) ? `APAAR: ${matchText(match.apaar_id)}` : "",
    matchText(match.grade) ? `Grade ${matchText(match.grade)}` : "",
    matchText(match.program),
    matchText(match.stream),
  ].filter(Boolean).join(" | ");

  return [
    `This identifier already belongs to ${matchText(match.student_name) || "a student"} at ${schoolName} (${matchSchoolCode}${udise ? `, UDISE ${udise}` : ""})${location ? `, ${location}` : ""}.`,
    identifiers,
  ].filter(Boolean).join(" ");
}

function formatFieldErrors(errors: Record<string, string> | undefined): string {
  return Object.entries(errors ?? {})
    .map(([key, message]) => `${UPLOAD_FIELD_LABELS.get(key as keyof StudentAdditionInput) ?? key}: ${message}`)
    .join("; ");
}

export function buildRejectedRowsCsv(results: StudentAdditionCsvResult[]): string {
  const headers = [
    "Original Row Number",
    "Row Status",
    ...STUDENT_ADDITION_UPLOAD_COLUMNS.map((column) => column.label),
    "Field Errors",
    "Row Errors",
    "Matched Identifier",
    "Existing Student ID",
    "Existing APAAR ID",
    "Existing Student Name",
    "Existing School Name",
    "Existing School Code",
    "Existing UDISE",
    "Existing District",
    "Existing State",
    "Existing Grade",
    "Existing Program",
    "Existing Stream",
  ];

  const rows = results
    .filter((result) => result.status === "rejected")
    // fallow-ignore-next-line complexity
    .map((result) => {
      const existing = result.existing_match ?? {};
      return [
        result.row_number ?? "",
        result.status ?? "",
        ...STUDENT_ADDITION_UPLOAD_COLUMNS.map((column) => result.original?.[column.label] ?? ""),
        formatFieldErrors(result.field_errors),
        (result.row_errors ?? []).join("; "),
        existing.matched_identifier ?? "",
        existing.student_id ?? "",
        existing.apaar_id ?? "",
        existing.student_name ?? "",
        existing.school_name ?? "",
        existing.school_code ?? "",
        existing.udise_code ?? "",
        existing.district ?? "",
        existing.state ?? "",
        existing.grade ?? "",
        existing.program ?? "",
        existing.stream ?? "",
      ].map(csvCell).join(",");
    });

  return [headers.join(","), ...rows].join("\n");
}

export interface LmsStudentAdditionRow {
  row_number: number;
  grade: 11 | 12;
  student_name: string;
  date_of_birth: string;
  gender: string;
  category: string;
  physically_handicapped: boolean;
  apaar_id: string;
  g10_board: string;
  g10_roll_no: string;
  board_stream: string;
  stream: LmsStudentStream;
  father_name: string;
  phone: string;
  annual_family_income: string;
}

export type StudentAdditionValidationResult =
  | {
      ok: true;
      row: LmsStudentAdditionRow;
      generatedStudentId: string | null;
      fieldErrors: Record<string, never>;
      rowErrors: [];
    }
  | {
      ok: false;
      row: Partial<LmsStudentAdditionRow>;
      generatedStudentId: string | null;
      fieldErrors: Record<string, string>;
      rowErrors: string[];
    };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: unknown): string {
  return stringValue(value)
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeG10RollNo(value: unknown): string {
  return stringValue(value).replace(/\s+/g, "").toUpperCase();
}

export function generateStudentId(
  grade: 11 | 12,
  g10RollNo: string,
  academicYear = CURRENT_ACADEMIC_YEAR,
): string | null {
  if (!g10RollNo) return null;
  const academicStart = Number(academicYear.split("-")[0]);
  return `${academicStart + (grade === 11 ? 2 : 1)}${g10RollNo}`;
}

function parseGrade(value: unknown): 11 | 12 | null {
  const grade = Number(stringValue(value) || value);
  return grade === 11 || grade === 12 ? grade : null;
}

function parseDate(value: unknown): string | null {
  const raw = stringValue(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : dmy
      ? { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) }
      : null;
  if (!parts) return null;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isoToday(today: Date): string {
  return today.toISOString().slice(0, 10);
}

function parsePhysicallyHandicapped(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  return null;
}

function parseStream(value: unknown): LmsStudentStream | null {
  return STREAM_MAP[stringValue(value).toLowerCase()] ?? null;
}

function addError(errors: Record<string, string>, key: string, message: string) {
  if (!errors[key]) errors[key] = message;
}

// fallow-ignore-next-line complexity
export function validateStudentAdditionInput(
  input: StudentAdditionInput,
  options: { today?: Date; rowNumber?: number; academicYear?: string } = {},
): StudentAdditionValidationResult {
  const today = options.today ?? new Date();
  const fieldErrors: Record<string, string> = {};
  const rowErrors: string[] = [];

  const grade = parseGrade(input.grade);
  if (!grade) addError(fieldErrors, "grade", "Grade must be 11 or 12");

  const student_name = normalizeName(input.student_name);
  if (!student_name) addError(fieldErrors, "student_name", "Student Name is required");

  const date_of_birth = parseDate(input.date_of_birth);
  if (!date_of_birth) {
    addError(fieldErrors, "date_of_birth", "Date of Birth must be DD/MM/YYYY or YYYY-MM-DD");
  } else if (date_of_birth > isoToday(today)) {
    addError(fieldErrors, "date_of_birth", "Date of Birth cannot be in the future");
  }

  const gender = stringValue(input.gender);
  if (!GENDER_SET.has(gender)) addError(fieldErrors, "gender", "Gender must be Female, Male, or Others");

  const category = stringValue(input.category);
  if (!CATEGORY_SET.has(category)) addError(fieldErrors, "category", "Category is not valid");

  const physically_handicapped = parsePhysicallyHandicapped(input.physically_handicapped);
  if (physically_handicapped === null) {
    addError(fieldErrors, "physically_handicapped", "Physical Handicapped must be Yes or No");
  }

  const apaar_id = stringValue(input.apaar_id);
  if (apaar_id && !/^\d{12}$/.test(apaar_id)) {
    addError(fieldErrors, "apaar_id", "APAAR ID must be exactly 12 digits");
  }

  const g10_board = stringValue(input.g10_board);
  if (!BOARD_SET.has(g10_board)) addError(fieldErrors, "g10_board", "G10 board is not valid");

  const g10_roll_no = normalizeG10RollNo(input.g10_roll_no);
  if (!apaar_id && !g10_roll_no) rowErrors.push("APAAR ID or Grade 10 Roll no is required");
  if (g10_roll_no) {
    if (g10_board === CBSE_BOARD && !/^\d{8}$/.test(g10_roll_no)) {
      addError(fieldErrors, "g10_roll_no", "CBSE Grade 10 Roll no must be exactly 8 digits");
    } else if (!/^[A-Z0-9]+$/.test(g10_roll_no)) {
      addError(fieldErrors, "g10_roll_no", "Grade 10 Roll no must contain only letters and digits");
    }
  }

  const board_stream = stringValue(input.board_stream);
  if (!BOARD_STREAM_SET.has(board_stream)) {
    addError(fieldErrors, "board_stream", "Board Stream is not valid");
  }

  const stream = parseStream(input.stream);
  if (!stream) addError(fieldErrors, "stream", "Primary Exam preparing for is not valid");

  const father_name = normalizeName(input.father_name);
  const phone = stringValue(input.phone);
  if (!/^\d{10}$/.test(phone)) {
    addError(fieldErrors, "phone", "Parents Phone Number must be exactly 10 digits");
  }

  const annual_family_income = stringValue(input.annual_family_income);
  if (annual_family_income && !INCOME_SET.has(annual_family_income)) {
    addError(fieldErrors, "annual_family_income", "Annual Family Income is not valid");
  }

  const generatedStudentId = grade
    ? generateStudentId(grade, g10_roll_no, options.academicYear)
    : null;
  const row = {
    row_number: options.rowNumber ?? 1,
    ...(grade ? { grade } : {}),
    student_name,
    ...(date_of_birth ? { date_of_birth } : {}),
    gender,
    category,
    ...(physically_handicapped !== null ? { physically_handicapped } : {}),
    apaar_id,
    g10_board,
    g10_roll_no,
    board_stream,
    ...(stream ? { stream } : {}),
    father_name,
    phone,
    annual_family_income,
  };

  if (Object.keys(fieldErrors).length > 0 || rowErrors.length > 0) {
    return { ok: false, row, generatedStudentId, fieldErrors, rowErrors };
  }

  return {
    ok: true,
    row: row as LmsStudentAdditionRow,
    generatedStudentId,
    fieldErrors: {},
    rowErrors: [],
  };
}
