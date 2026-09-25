// Client-safe types and constants for intervention flags. The server module
// (`intervention-flags.ts`) imports the database, so client components import
// from here instead.

export const INTERVENTION_FLAG_NOTE_MAX_LENGTH = 2000;

export type InterventionFlagStatus = "open" | "resolved";

export interface InterventionFlagUpdate {
  id: number;
  author_email: string;
  author_name: string | null;
  body: string | null;
  status_from: InterventionFlagStatus | null;
  status_to: InterventionFlagStatus | null;
  inserted_at: string;
}

export interface InterventionFlag {
  id: number;
  student_pk_id: string;
  status: InterventionFlagStatus;
  raised_by_email: string;
  inserted_at: string;
  resolved_at: string | null;
  updates: InterventionFlagUpdate[];
}

export interface OpenInterventionFlagSummary {
  id: number;
  student_pk_id: string;
  student_name: string;
  school_code: string;
  school_udise: string | null;
  school_name: string;
  raised_by_email: string;
  inserted_at: string;
  latest_note: string | null;
  latest_at: string;
}
