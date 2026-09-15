-- Mirrors DB Service #727 so local progress tests use the production roster view.
CREATE OR REPLACE VIEW centre_students AS
SELECT
  c.id            AS centre_id,
  gu.user_id      AS user_id,
  er.academic_year,
  gr.number       AS grade,
  c.program_id
FROM centres c
JOIN "group" g ON g.type = 'school' AND g.child_id = c.school_id
JOIN group_user gu ON gu.group_id = g.id
JOIN enrollment_record er ON er.user_id = gu.user_id
  AND er.group_type = 'grade'
  AND er.is_current = true
LEFT JOIN grade gr ON er.group_id = gr.id
WHERE c.is_active
  AND EXISTS (
    SELECT 1
    FROM group_user gub
    JOIN "group" gb ON gub.group_id = gb.id AND gb.type = 'batch'
    JOIN batch b ON gb.child_id = b.id
    WHERE gub.user_id = gu.user_id
      AND b.program_id = c.program_id
  );
