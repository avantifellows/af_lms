UPDATE school
SET program_ids = CASE
  WHEN 1 = ANY(COALESCE(program_ids, '{}'::integer[])) THEN program_ids
  ELSE array_append(COALESCE(program_ids, '{}'::integer[]), 1)
END
WHERE code = '14061';

INSERT INTO centres (name, school_id, program_id, is_physical, is_active)
SELECT 'Holistic E2E Centre', school.id, 1, true, true
FROM school
WHERE school.code = '14061'
  AND NOT EXISTS (
    SELECT 1
    FROM centres
    WHERE centres.school_id = school.id
      AND centres.program_id = 1
      AND centres.is_physical = true
      AND centres.is_active = true
  );

WITH candidates AS (
  SELECT DISTINCT
    grade_enrollment.id AS enrollment_id,
    grade.number AS grade,
    student.id AS student_id
  FROM school
  JOIN "group" school_group
    ON school_group.type = 'school'
   AND school_group.child_id = school.id
  JOIN group_user school_member ON school_member.group_id = school_group.id
  JOIN student ON student.user_id = school_member.user_id
  JOIN enrollment_record grade_enrollment
    ON grade_enrollment.user_id = student.user_id
   AND grade_enrollment.group_type = 'grade'
   AND grade_enrollment.academic_year = '2025-2026'
   AND grade_enrollment.is_current = true
  JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
  WHERE school.code = '14061'
    AND student.status IS DISTINCT FROM 'dropout'
    AND EXISTS (
      SELECT 1
      FROM group_user batch_member
      JOIN "group" batch_group
        ON batch_group.id = batch_member.group_id
       AND batch_group.type = 'batch'
      JOIN batch ON batch.id = batch_group.child_id
      WHERE batch_member.user_id = student.user_id
        AND batch.program_id = 1
    )
), ranked AS (
  SELECT
    enrollment_id,
    ROW_NUMBER() OVER (PARTITION BY grade ORDER BY student_id) AS position
  FROM candidates
)
UPDATE enrollment_record
SET academic_year = '2026-2027',
    updated_at = (NOW() AT TIME ZONE 'UTC')
WHERE id IN (
  SELECT enrollment_id
  FROM ranked
  WHERE position <= 3
);
