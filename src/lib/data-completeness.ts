// The Enrollment tab's Data completeness table (issue #468): for each profile
// field, document and expected exam, how many of the Program's Students are
// missing it, and which Students those are.
//
// Physical centres only. JNV NVS keeps the Admission row it has today — PMU
// did not ask for this, and the uniform-size, document and exam features
// before it were all physical-centre only (#395, #431, #434).
//
// No server-only imports: the table, the filter it drives and the tests all
// read this module, so a count and the Students behind it can never disagree.

import type { Student } from "@/components/StudentTable";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";
import {
  boardStreamsExpecting,
  compareExamNames,
  requiredExamNamesForBoardStream,
  STREAM_EXPECTED_EXAM_NAMES,
} from "@/lib/competitive-exams";

/** Document types a Student is expected to have, marked `*` in the table. */
const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = [
  "parent_undertaking",
  "wise_research_consent",
];

// A Student in the general category — including the EWS and PWD spellings the
// `category` column carries (Gen, Gen-EWS, PWD-Gen, PWD-EWS, General, and the
// case variants). Most states issue no caste certificate to them, so counting
// them as missing one would be chasing a document they cannot obtain.
const GENERAL_CATEGORY = /^(pwd-)?(gen|general)(-ews)?$|^(pwd-)?ews$/i;

/**
 * Whether this Student could produce a caste certificate at all. A blank
 * category stays counted: nothing rules it out, and the Category chip is where
 * that gap shows.
 */
function expectsCasteCertificate(student: Student): boolean {
  const category = student.category?.trim();
  if (!category) return true;
  return !GENERAL_CATEGORY.test(category);
}

// Who each document applies to. Everything but the caste certificate applies
// to every Student in scope.
const DOCUMENT_APPLIES_TO: Partial<
  Record<DocumentType, (student: Student) => boolean>
> = {
  caste_certificate: expectsCasteCertificate,
};

/** `student_pk_id` → the document types on file for that Student. */
export type DocumentTypesByStudentId = Record<string, DocumentType[]>;

function filled(value: unknown): boolean {
  return value != null && String(value).trim() !== "";
}

interface InfoItemDefinition {
  /** Stable key, used as the filter key and in tests. */
  field: string;
  label: string;
  /** Edit Student can't change it — the table marks these with a lock. */
  locked?: boolean;
  isFilled: (student: Student) => boolean;
}

// The ten details the Programs team tracks per Student (issue #468). This is
// the one list: the table's Info row and its percentage both read it. It is
// deliberately not `INFO_REQUIRED_FIELDS` from `enrollment-readiness.ts` —
// that list answers a different question (one all-or-nothing percentage per
// School, narrowed in #338 so it reads honestly), and this one can afford the
// rarely-filled fields because each shows as its own chip rather than sinking
// a single number.
export const INFO_ITEMS: readonly InfoItemDefinition[] = [
  {
    field: "date_of_birth",
    label: "Date of Birth",
    isFilled: (s) => filled(s.date_of_birth),
  },
  { field: "gender", label: "Gender", isFilled: (s) => filled(s.gender) },
  { field: "category", label: "Category", isFilled: (s) => filled(s.category) },
  {
    field: "phone",
    label: "Parents Phone Number",
    isFilled: (s) => filled(s.phone),
  },
  {
    field: "annual_family_income",
    label: "Annual Family Income",
    isFilled: (s) => filled(s.annual_family_income),
  },
  {
    field: "father_name",
    label: "Father Name",
    isFilled: (s) => filled(s.father_name),
  },
  {
    field: "mother_name",
    label: "Mother Name",
    isFilled: (s) => filled(s.mother_name),
  },
  { field: "address", label: "Address", isFilled: (s) => filled(s.address) },
  {
    // One chip for both sizes: Edit Student collects them in a single Uniform
    // Size section, so a Student with one of the two is still a Student whose
    // uniform can't be ordered.
    field: "uniform_size",
    label: "Uniform Size",
    isFilled: (s) => filled(s.tshirt_size) && filled(s.track_pant_size),
  },
  {
    field: "apaar_id",
    label: "APAAR ID",
    locked: true,
    isFilled: (s) => filled(s.apaar_id),
  },
  {
    // One chip, two columns: either identifier answers "can this Student be
    // identified to the board", and a School that has one rarely has both.
    field: "pen_or_roll",
    label: "PEN / Grade 10 Roll no",
    locked: true,
    isFilled: (s) => filled(s.pen_number) || filled(s.g10_roll_no),
  },
];

export type CompletenessGroupKey = "info" | "documents" | "exams";

const GROUP_TITLES: Record<CompletenessGroupKey, string> = {
  info: "Info",
  documents: "Documents",
  exams: "Exams",
};

/**
 * What the student list is narrowed to. An item key (`info:address`,
 * `doc:caste_certificate`, `exam:JEE Mains`) is one chip; a group key
 * (`group:info`) is "missing any item in this group".
 */
export type CompletenessFilterKey = string;

export function infoFilterKey(field: string): CompletenessFilterKey {
  return `info:${field}`;
}
export function documentFilterKey(type: DocumentType): CompletenessFilterKey {
  return `doc:${type}`;
}
export function examFilterKey(examName: string): CompletenessFilterKey {
  return `exam:${examName}`;
}
export function groupFilterKey(group: CompletenessGroupKey): CompletenessFilterKey {
  return `group:${group}`;
}

export interface CompletenessItem {
  key: CompletenessFilterKey;
  label: string;
  /** Students in scope missing this item. */
  missing: number;
  /**
   * Students this item applies to — the denominator behind `missing`. Every
   * Student in scope for a profile field or a document, but only the Students
   * whose Board Stream calls for an exam: ten of eleven PCB Students with no
   * NEET registration is a red chip, not the pale 10-of-77 it would read as
   * against the whole roster.
   */
  expected: number;
  /** The filter line's wording: "Missing Address", "Not registered for NEET". */
  filterLabel: string;
  locked: boolean;
  required: boolean;
}

export interface CompletenessGroup {
  key: CompletenessGroupKey;
  title: string;
  /**
   * Share of the group's (Student × item) slots that are filled, rounded.
   * Slot-based rather than all-or-nothing, so the number moves as gaps close
   * instead of waiting on the last Student.
   */
  pct: number;
  /** Items at least one Student is missing, worst first. */
  items: CompletenessItem[];
  /** Labels of the items nobody is missing; the table folds them into one chip. */
  complete: string[];
  /** Why a row is empty or short, e.g. "NEET not expected (no PCB)". */
  notes: string[];
  /** True while the documents read is still in flight. */
  pending: boolean;
}

export interface DataCompleteness {
  /** Students in scope — the selected Program, grade and stream. */
  total: number;
  groups: CompletenessGroup[];
}

export type Severity = "high" | "medium" | "low";

/**
 * How loudly a chip's count reads: red from half the Students up, amber from a
 * fifth. Below that it is a handful of records, not a collection gap.
 */
export function severityFor(missing: number, total: number): Severity {
  if (total <= 0) return "low";
  const share = missing / total;
  if (share >= 0.5) return "high";
  if (share >= 0.2) return "medium";
  return "low";
}

function pct(filledSlots: number, totalSlots: number): number {
  if (totalSlots <= 0) return 100;
  return Math.round((filledSlots / totalSlots) * 100);
}

function documentTypesFor(
  student: Student,
  documents: DocumentTypesByStudentId,
): ReadonlySet<DocumentType> {
  const id = student.student_pk_id;
  return new Set(id ? (documents[id] ?? []) : []);
}

/** Exam names this Student's Board Stream calls for, registered or not. */
function expectedExamNames(student: Student): readonly string[] {
  return requiredExamNamesForBoardStream(student.board_stream);
}

function registeredExamNames(student: Student): ReadonlySet<string> {
  return new Set((student.exam_records ?? []).map((record) => record.exam_name));
}

/** Which documents this Student could have on file but doesn't. */
function missingDocumentKeys(
  student: Student,
  documents: DocumentTypesByStudentId,
): CompletenessFilterKey[] {
  const present = documentTypesFor(student, documents);
  return DOCUMENT_TYPES.filter(({ value }) => {
    const appliesTo = DOCUMENT_APPLIES_TO[value];
    return (!appliesTo || appliesTo(student)) && !present.has(value);
  }).map(({ value }) => documentFilterKey(value));
}

/**
 * Every item key this Student is missing, across all three groups. One pass
 * per Student answers both the counts and "is this Student in the filter", so
 * the chip's number and the list it opens are always the same rule.
 *
 * `documents` absent (the bulk read hasn't landed) leaves document keys out
 * rather than reporting every Student as missing every document.
 */
export function missingKeysForStudent(
  student: Student,
  documents: DocumentTypesByStudentId | null,
): Set<CompletenessFilterKey> {
  const keys = new Set<CompletenessFilterKey>();

  for (const item of INFO_ITEMS) {
    if (!item.isFilled(student)) keys.add(infoFilterKey(item.field));
  }

  if (documents) {
    for (const key of missingDocumentKeys(student, documents)) keys.add(key);
  }

  const registered = registeredExamNames(student);
  for (const examName of expectedExamNames(student)) {
    if (!registered.has(examName)) keys.add(examFilterKey(examName));
  }

  return keys;
}

function groupOf(key: CompletenessFilterKey): CompletenessGroupKey | null {
  if (key.startsWith("info:")) return "info";
  if (key.startsWith("doc:")) return "documents";
  if (key.startsWith("exam:")) return "exams";
  return null;
}

/**
 * True when this Student belongs in the list a chip or group label opens.
 * An unknown key matches nobody, so a stale filter empties the list rather
 * than quietly showing everyone.
 */
export function studentMatchesCompletenessFilter(
  student: Student,
  filterKey: CompletenessFilterKey,
  documents: DocumentTypesByStudentId | null,
): boolean {
  const missing = missingKeysForStudent(student, documents);
  if (filterKey.startsWith("group:")) {
    const group = filterKey.slice("group:".length) as CompletenessGroupKey;
    for (const key of missing) {
      if (groupOf(key) === group) return true;
    }
    return false;
  }
  return missing.has(filterKey);
}

export function countStudentsMatching(
  students: Student[],
  filterKey: CompletenessFilterKey,
  documents: DocumentTypesByStudentId | null,
): number {
  return students.filter((student) =>
    studentMatchesCompletenessFilter(student, filterKey, documents),
  ).length;
}

function buildInfoGroup(students: Student[]): CompletenessGroup {
  const items: CompletenessItem[] = [];
  const complete: string[] = [];
  let filledSlots = 0;

  for (const item of INFO_ITEMS) {
    const missing = students.filter((student) => !item.isFilled(student)).length;
    filledSlots += students.length - missing;
    if (missing === 0) {
      complete.push(item.label);
      continue;
    }
    items.push({
      key: infoFilterKey(item.field),
      label: item.label,
      missing,
      expected: students.length,
      filterLabel: `Missing ${item.label}`,
      locked: item.locked === true,
      required: false,
    });
  }

  return {
    key: "info",
    title: GROUP_TITLES.info,
    pct: pct(filledSlots, students.length * INFO_ITEMS.length),
    items: sortByMissing(items),
    complete,
    notes: [],
    pending: false,
  };
}

function buildDocumentsGroup(
  students: Student[],
  documents: DocumentTypesByStudentId | null,
): CompletenessGroup {
  if (!documents) {
    return {
      key: "documents",
      title: GROUP_TITLES.documents,
      pct: 0,
      items: [],
      complete: [],
      notes: [],
      pending: true,
    };
  }

  const present = new Map(
    students.map((student) => [student, documentTypesFor(student, documents)]),
  );
  const items: CompletenessItem[] = [];
  const complete: string[] = [];
  const notes: string[] = [];
  let filledSlots = 0;
  let totalSlots = 0;

  for (const { value, label } of DOCUMENT_TYPES) {
    const appliesTo = DOCUMENT_APPLIES_TO[value];
    const expecting = appliesTo ? students.filter(appliesTo) : students;
    if (expecting.length === 0) {
      // Nobody here could produce it, so it is neither a gap nor "complete".
      if (students.length > 0 && appliesTo) {
        notes.push(`${label} not expected — no Student in a reserved category`);
      }
      continue;
    }
    const missing = expecting.filter(
      (student) => !present.get(student)?.has(value),
    ).length;
    filledSlots += expecting.length - missing;
    totalSlots += expecting.length;
    if (missing === 0) {
      complete.push(label);
      continue;
    }
    items.push({
      key: documentFilterKey(value),
      label,
      missing,
      expected: expecting.length,
      filterLabel: `Missing ${label}`,
      locked: false,
      required: REQUIRED_DOCUMENT_TYPES.includes(value),
    });
  }

  return {
    key: "documents",
    title: GROUP_TITLES.documents,
    pct: pct(filledSlots, totalSlots),
    items: sortByMissing(items),
    complete,
    notes,
    pending: false,
  };
}

// An exam no Student in scope is expected to sit earns a note rather than
// silence, so a missing NEET chip doesn't read as "NEET is covered".
function buildExamsGroup(students: Student[]): CompletenessGroup {
  const expectedBy = new Map<string, Student[]>();
  for (const student of students) {
    for (const examName of expectedExamNames(student)) {
      const list = expectedBy.get(examName) ?? [];
      list.push(student);
      expectedBy.set(examName, list);
    }
  }

  const items: CompletenessItem[] = [];
  const complete: string[] = [];
  const notes: string[] = [];
  let expectedSlots = 0;
  let registeredSlots = 0;

  for (const examName of STREAM_EXPECTED_EXAM_NAMES) {
    const expecting = expectedBy.get(examName) ?? [];
    if (expecting.length === 0) {
      notes.push(
        `${examName} not expected — no Student on ${formatStreams(boardStreamsExpecting(examName))}`,
      );
      continue;
    }
    const missing = expecting.filter(
      (student) => !registeredExamNames(student).has(examName),
    ).length;
    expectedSlots += expecting.length;
    registeredSlots += expecting.length - missing;
    if (missing === 0) {
      complete.push(examName);
      continue;
    }
    items.push({
      key: examFilterKey(examName),
      label: examName,
      missing,
      expected: expecting.length,
      filterLabel: `Not registered for ${examName}`,
      locked: false,
      required: true,
    });
  }

  return {
    key: "exams",
    title: GROUP_TITLES.exams,
    pct: pct(registeredSlots, expectedSlots),
    items: sortByMissing(items),
    complete,
    notes,
    pending: false,
  };
}

// "PCB or PCMB" — every stream that would have called for the exam, so the
// note says exactly which Students are absent rather than naming one stream
// and leaving the others unexplained.
function formatStreams(streams: string[]): string {
  if (streams.length <= 1) return streams[0] ?? "any stream";
  return `${streams.slice(0, -1).join(", ")} or ${streams[streams.length - 1]}`;
}

// Worst first, so the chip a PM should act on is the one nearest the label.
// Equal counts fall back to the exam picker's order, then alphabetical, so the
// row doesn't reshuffle between renders.
function sortByMissing(items: CompletenessItem[]): CompletenessItem[] {
  return [...items].sort(
    (a, b) => b.missing - a.missing || compareExamNames(a.label, b.label),
  );
}

/**
 * The whole table for the Students in scope — already narrowed to the selected
 * Program, grade and stream by the caller, so every number on the table agrees
 * with the roster below it.
 */
export function buildDataCompleteness(
  students: Student[],
  documents: DocumentTypesByStudentId | null,
): DataCompleteness {
  return {
    total: students.length,
    groups: [
      buildInfoGroup(students),
      buildDocumentsGroup(students, documents),
      buildExamsGroup(students),
    ],
  };
}

/** The filter line's wording for the active filter, or null if it isn't on the table. */
export function filterLabelFor(
  completeness: DataCompleteness,
  filterKey: CompletenessFilterKey | null,
): string | null {
  if (!filterKey) return null;
  if (filterKey.startsWith("group:")) {
    const group = filterKey.slice("group:".length) as CompletenessGroupKey;
    return (
      {
        info: "Any info missing",
        documents: "Any document missing",
        exams: "No exam registration",
      } satisfies Record<CompletenessGroupKey, string>
    )[group];
  }
  for (const group of completeness.groups) {
    const item = group.items.find((candidate) => candidate.key === filterKey);
    if (item) return item.filterLabel;
  }
  return null;
}
