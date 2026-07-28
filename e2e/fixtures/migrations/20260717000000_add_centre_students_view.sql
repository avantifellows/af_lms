CREATE OR REPLACE VIEW centre_students AS
SELECT centre.id AS centre_id,
       school_member.user_id,
       grade_enrollment.academic_year,
       grade.number AS grade,
       roster_program.program_id
FROM centres centre
JOIN "group" school_group
  ON school_group.type = 'school'
 AND school_group.child_id = centre.school_id
JOIN group_user school_member ON school_member.group_id = school_group.id
JOIN enrollment_record grade_enrollment
  ON grade_enrollment.user_id = school_member.user_id
 AND grade_enrollment.group_type = 'grade'
 AND grade_enrollment.is_current IS TRUE
LEFT JOIN grade ON grade.id = grade_enrollment.group_id
LEFT JOIN LATERAL (
  SELECT batch.program_id
  FROM group_user batch_member
  JOIN "group" batch_group
    ON batch_group.id = batch_member.group_id
   AND batch_group.type = 'batch'
  JOIN batch ON batch.id = batch_group.child_id
  JOIN program ON program.id = batch.program_id
  WHERE batch_member.user_id = school_member.user_id
  ORDER BY array_position(ARRAY['JNV CoE', 'JNV Nodal', 'JNV NVS']::text[], program.name::text)
  LIMIT 1
) roster_program ON TRUE
WHERE centre.is_active IS TRUE
  AND roster_program.program_id = centre.program_id;
