import { query } from "./db";

interface CentreRow {
  id: number | string;
  name: string;
}

export type CentreResolutionResult =
  | { ok: true; centre: { id: number; name: string } }
  | {
      ok: false;
      code: "missing_centre" | "ambiguous_centre";
      error: string;
    };

export async function resolveActivePhysicalCentre(params: {
  schoolCode: string;
  programId: number;
}): Promise<CentreResolutionResult> {
  const centres = await query<CentreRow>(
    `SELECT centres.id, centres.name
     FROM centres
     JOIN school ON school.id = centres.school_id
     WHERE school.code = $1
       AND centres.program_id = $2
       AND centres.is_active = true
       AND centres.is_physical = true
     ORDER BY centres.id
     LIMIT 2`,
    [params.schoolCode, params.programId]
  );

  if (centres.length === 1) {
    return {
      ok: true,
      centre: { id: Number(centres[0].id), name: centres[0].name },
    };
  }

  return centres.length === 0
    ? {
        ok: false,
        code: "missing_centre",
        error: "Curriculum Centre configuration error: no active physical Centre is configured for this School and Program",
      }
    : {
        ok: false,
        code: "ambiguous_centre",
        error: "Curriculum Centre configuration error: multiple active physical Centres are configured for this School and Program",
      };
}

export async function validateCentreExamTrackMapping(params: {
  schoolCode: string;
  programId: number;
  grade: number;
  examTrack: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const centre = await resolveActivePhysicalCentre(params);
  if (!centre.ok) return { ok: false, error: centre.error };

  const rows = await query<{ exists: boolean }>(
    `SELECT true AS exists
     FROM centre_exam_tracks mapping
     JOIN grade ON grade.id = mapping.grade_id
     WHERE mapping.centre_id = $1
       AND grade.number = $2
       AND mapping.exam_track_code = $3
     LIMIT 1`,
    [centre.centre.id, params.grade, params.examTrack]
  );

  return rows.length > 0
    ? { ok: true }
    : {
        ok: false,
        error: "No Exam Tracks configured for this Centre and Grade",
      };
}
