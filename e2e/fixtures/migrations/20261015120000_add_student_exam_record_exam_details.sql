-- Mirrors db-service 20261015120000_add_exam_details_to_student_exam_record,
-- which db-dump.sql predates. The JEE form card writes exam_year (through the
-- DB Service, which e2e stubs) and reads it back.

ALTER TABLE public.student_exam_record
  ADD COLUMN exam_email character varying(255),
  ADD COLUMN exam_phone character varying(15),
  ADD COLUMN exam_roll_no character varying(50),
  ADD COLUMN exam_year integer;
