import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  holisticJsonProgramId,
  holisticProgramId,
  positiveInteger,
  validSchoolCode,
} from "@/lib/holistic-request-validation";

export type MappingParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface HolisticMappingRosterFilters {
  schoolCode: string;
  programId: number;
  academicYear: string;
  search: string;
  grade: 11 | 12 | null;
}

export interface HolisticTeacherMappingSelection {
  studentId: number;
  expectedMappingId: number | null;
}

export interface HolisticTeacherMappingRequest {
  schoolCode: string;
  programId: number;
  academicYear: string;
  selections: HolisticTeacherMappingSelection[];
}

export interface HolisticTeacherRemovalSelection {
  studentId: number;
  expectedMappingId: number;
}

export interface HolisticTeacherRemovalRequest {
  schoolCode: string;
  programId: number;
  academicYear: string;
  confirmed: true;
  mappings: HolisticTeacherRemovalSelection[];
}

export interface HolisticAdminMappingRequest {
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  expectedMappingId: number | null;
  mentorUserId: number;
}

export interface HolisticAdminAssignRequest extends HolisticAdminMappingRequest {
  expectedMappingId: null;
}

export interface HolisticAdminReassignRequest extends HolisticAdminMappingRequest {
  expectedMappingId: number;
}

export interface HolisticAdminRemoveRequest {
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  expectedMappingId: number;
}

type MappingParseFailure = { ok: false; error: string };

function failure(error: string): MappingParseFailure {
  return { ok: false, error };
}

function parseExplicitProgramId(value: Record<string, unknown>): MappingParseResult<number> {
  if (!("program_id" in value)) return failure("Program is required");
  const programId = holisticJsonProgramId(value.program_id);
  return programId ? { ok: true, value: programId } : failure("Invalid Program");
}

function parseAdminMutationBase(
  value: Record<string, unknown>,
  messages: { year: string; confirmation: string; reason: string },
): MappingParseResult<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
}> {
  const parsedProgramId = parseExplicitProgramId(value);
  if (!parsedProgramId.ok) return parsedProgramId;
  if (!validSchoolCode(value.school_code)) return failure("Invalid School");
  if (value.academic_year !== CURRENT_ACADEMIC_YEAR) return failure(messages.year);
  if (value.confirmed !== true) return failure(messages.confirmation);
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return failure(messages.reason);
  if (reason.length > 500) return failure("Audit reason must be 500 characters or fewer");
  return {
    ok: true,
    value: {
      schoolCode: value.school_code,
      programId: parsedProgramId.value,
      academicYear: value.academic_year,
      reason,
    },
  };
}

function parseAdminMentorMutation(
  value: Record<string, unknown>,
  messages: { year: string; confirmation: string; reason: string },
): MappingParseResult<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  mentorUserId: number;
}> {
  const base = parseAdminMutationBase(value, messages);
  if (!base.ok) return base;
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return failure("Invalid Student");
  const mentorUserId = positiveInteger(value.mentor_user_id);
  if (!mentorUserId) return failure("Invalid Mentor");
  return { ok: true, value: { ...base.value, studentId, mentorUserId } };
}

function parseTeacherRequest(
  value: Record<string, unknown> | null,
  invalidMessage: string,
): MappingParseResult<{ payload: Record<string, unknown>; programId: number }> {
  if (!value) return failure(invalidMessage);
  const parsedProgramId = parseExplicitProgramId(value);
  if (!parsedProgramId.ok) return parsedProgramId;
  return { ok: true, value: { payload: value, programId: parsedProgramId.value } };
}

function parseTeacherSelectionList(
  value: unknown,
  itemMessage: string,
  parseItem: (item: Record<string, unknown>) =>
    HolisticTeacherMappingSelection | HolisticTeacherRemovalSelection | null,
): MappingParseResult<Array<HolisticTeacherMappingSelection | HolisticTeacherRemovalSelection>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return failure(itemMessage);
  const selections = value.map((selection) => {
    if (!selection || typeof selection !== "object") return null;
    return parseItem(selection as Record<string, unknown>);
  });
  if (selections.some((selection) => !selection) ||
      new Set(selections.map((selection) => selection!.studentId)).size !== selections.length) {
    return failure(itemMessage);
  }
  return { ok: true, value: selections as Array<HolisticTeacherMappingSelection | HolisticTeacherRemovalSelection> };
}

export function isAdminAssignRequest(value: Record<string, unknown>): boolean {
  return "student_id" in value || "mentor_user_id" in value ||
    "confirmed" in value || "reason" in value;
}

export function isAdminRemoveRequest(value: Record<string, unknown>): boolean {
  return "student_id" in value || "expected_mapping_id" in value || "reason" in value;
}

export function parseHolisticMappingRosterFilters(
  params: URLSearchParams,
): MappingParseResult<HolisticMappingRosterFilters> {
  const schoolCode = params.get("school_code");
  const academicYear = params.get("academic_year") ?? CURRENT_ACADEMIC_YEAR;
  const programId = holisticProgramId(params.get("program_id"));
  const search = (params.get("search") ?? "").trim();
  const gradeValue = params.get("grade");
  const grade = gradeValue === null || gradeValue === "" ? null : Number(gradeValue);
  if (!programId || !validSchoolCode(schoolCode) || academicYear !== CURRENT_ACADEMIC_YEAR ||
      search.length > 100 || (grade !== null && grade !== 11 && grade !== 12)) {
    return failure("Invalid roster filters");
  }
  return {
    ok: true,
    value: {
      schoolCode,
      programId,
      academicYear,
      search,
      grade: grade as 11 | 12 | null,
    },
  };
}

export function parseHolisticTeacherClaim(
  value: Record<string, unknown> | null,
): MappingParseResult<HolisticTeacherMappingRequest> {
  const parsed = parseTeacherRequest(value, "Invalid Mapping selection");
  if (!parsed.ok) return parsed;
  const { payload, programId } = parsed.value;
  if (!validSchoolCode(payload.school_code) ||
      payload.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return failure("Invalid Mapping selection");
  }
  const selections = parseTeacherSelectionList(
    payload.selections,
    "Invalid Mapping selection",
    (selection) => {
      const studentId = positiveInteger(selection.student_id);
      const expectedMappingId = selection.expected_mapping_id === null
        ? null
        : positiveInteger(selection.expected_mapping_id);
      return studentId && (selection.expected_mapping_id === null || expectedMappingId)
        ? { studentId, expectedMappingId }
        : null;
    },
  );
  if (!selections.ok) return selections;
  return {
    ok: true,
    value: {
      schoolCode: payload.school_code,
      programId,
      academicYear: payload.academic_year,
      selections: selections.value as HolisticTeacherMappingSelection[],
    },
  };
}

export function parseHolisticAdminAssign(
  value: Record<string, unknown>,
): MappingParseResult<HolisticAdminAssignRequest> {
  const base = parseAdminMentorMutation(value, {
    year: "Admin Mapping assignments are limited to the current Academic Year",
    confirmation: "Assignment confirmation is required",
    reason: "Assignment reason is required",
  });
  if (!base.ok) return base;
  if (value.expected_mapping_id !== null) return failure("Expected Mapping must be unassigned");
  return { ok: true, value: { ...base.value, expectedMappingId: null } };
}

export function parseHolisticAdminReassign(
  value: Record<string, unknown>,
): MappingParseResult<HolisticAdminReassignRequest> {
  const base = parseAdminMentorMutation(value, {
    year: "Admin Mapping reassignments are limited to the current Academic Year",
    confirmation: "Reassignment confirmation is required",
    reason: "Reassignment reason is required",
  });
  if (!base.ok) return base;
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return failure("Invalid expected Mapping");
  return { ok: true, value: { ...base.value, expectedMappingId } };
}

export function parseHolisticAdminRemove(
  value: Record<string, unknown>,
): MappingParseResult<HolisticAdminRemoveRequest> {
  const base = parseAdminMutationBase(value, {
    year: "Admin Mapping removals are limited to the current Academic Year",
    confirmation: "Removal confirmation is required",
    reason: "Removal reason is required",
  });
  if (!base.ok) return base;
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return failure("Invalid Student");
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return failure("Invalid expected Mapping");
  return { ok: true, value: { ...base.value, studentId, expectedMappingId } };
}

export function parseHolisticTeacherRemoval(
  value: Record<string, unknown> | null,
): MappingParseResult<HolisticTeacherRemovalRequest> {
  const parsed = parseTeacherRequest(value, "Invalid Mapping removal");
  if (!parsed.ok) return parsed;
  const { payload, programId } = parsed.value;
  if (!validSchoolCode(payload.school_code) ||
      payload.academic_year !== CURRENT_ACADEMIC_YEAR ||
      payload.confirmed !== true) {
    return failure("Invalid Mapping removal");
  }
  const mappings = parseTeacherSelectionList(
    payload.mappings,
    "Invalid Mapping removal",
    (mapping) => {
      const studentId = positiveInteger(mapping.student_id);
      const expectedMappingId = positiveInteger(mapping.expected_mapping_id);
      return studentId && expectedMappingId ? { studentId, expectedMappingId } : null;
    },
  );
  if (!mappings.ok) return mappings;
  return {
    ok: true,
    value: {
      schoolCode: payload.school_code,
      programId,
      academicYear: payload.academic_year,
      confirmed: true,
      mappings: mappings.value as HolisticTeacherRemovalSelection[],
    },
  };
}
