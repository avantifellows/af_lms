// Admin-side shape for the Blended Learning roles: no School scope and no
// Programs, whatever the request says. Level 1 with no school_codes is the
// narrowest stored scope; the shared permission lookup denies these roles
// anyway, so the row never grants School access.
export const BLENDED_ROW = {
  level: 1,
  school_codes: null,
  regions: null,
  program_ids: [] as number[],
};

export const BLENDED_SEATED_ERROR =
  "This user is assigned to a centre. Remove their centre assignments in Staff Management before giving them a Blended Learning role.";
