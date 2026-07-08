-- One-off backfill: fill teacher.subject_id for AF teachers seated with a
-- subject seat role (physics/chemistry/maths/biology) but whose subject_id is
-- still NULL. The seat role names map case-insensitively onto subject.name.
--
-- Root cause: assigning a centre seat (createPosition / setUserRole) wrote
-- centre_positions.role but never synced teacher.subject_id — the column the
-- Staff Management "Subject" column reads. Code fix wires that sync going
-- forward; this backfills the rows created before the fix.
--
-- SAFE: only touches teacher rows where subject_id IS NULL. Does NOT overwrite
-- any teacher whose subject_id is already set (incl. the known seat-role vs
-- subject_id mismatches, which need a human decision — see note below).
--
-- Affected as of 2026-06-25 (8 teachers): gouri, kumarrahul76543, piyushyadav,
-- prerna, rahulmodi, sandeepkumar, shivamajnu9133, somesh.bis.

BEGIN;

UPDATE teacher t
SET subject_id = s.id,
    updated_at = now()
FROM centre_positions cp
JOIN subject s ON LOWER(s.name->0->>'subject') = cp.role
WHERE cp.user_id = t.user_id
  AND t.is_af_teacher = true
  AND cp.deleted_at IS NULL
  AND cp.role IN ('physics', 'chemistry', 'maths', 'biology')
  AND t.subject_id IS NULL;

-- Expect: UPDATE 8
COMMIT;

-- ---------------------------------------------------------------------------
-- NOT handled here (needs a human call): 3 teachers whose seat role and
-- existing subject_id disagree. Decide which is correct before changing:
--   tofan@avantifellows.org      seat 'physics'  but subject_id 1 (Maths)
--   janagama.adithya@...org      seat 'physics'  but subject_id 2 (Chemistry)
--   balia@avantifellows.org      seat 'physics'  but subject_id 1 (Maths)
-- ---------------------------------------------------------------------------
