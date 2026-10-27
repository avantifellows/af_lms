import type { HolisticChallengeCategoryCode } from "@/lib/holistic-challenge-categories";

export type ChallengeCategoryCounts = Record<HolisticChallengeCategoryCode, number>;

// Share of Students with >= 1 Category-bearing submitted Post-Session Note who
// carry each Challenge Category. Counts only; no per-Student identity.
export type ChallengeCategoryHeatmap = {
  programIds: number[];
  academicYear: string;
  grade: 11 | 12;
  phaseId: number | null; // null = All Phases
  phases: Array<{ id: number; number: number; title: string; state: "open" | "locked" }>; // that Grade, Plan order
  defaultPhaseId: number | null; // latest Open Phase of that Grade, else null
  academicYears: string[];
  total: { studentCount: number; counts: ChallengeCategoryCounts }; // "All Schools"
  // n > 0, by name then code. Keyed by School id: `code` may be empty or shared.
  schools: Array<{ id: number; code: string; name: string; studentCount: number; counts: ChallengeCategoryCounts }>;
  hiddenSchoolCount: number; // in-scope Mapping Schools with n = 0
};
