-- Student uniform sizes and Grade 10 school for e2e. The School roster read
-- (getSchoolRoster) selects them, so a local db-dump.sql taken before db-service
-- 20260925130000_add_uniform_sizes_and_g10_school_to_student fails every School page.
-- This mirrors that migration (keep it identical) and is a no-op on a refreshed dump.

ALTER TABLE student
  ADD COLUMN IF NOT EXISTS tshirt_size varchar(4),
  ADD COLUMN IF NOT EXISTS track_pant_size varchar(4),
  ADD COLUMN IF NOT EXISTS g10_school_state varchar(50),
  ADD COLUMN IF NOT EXISTS g10_school_name varchar(150),
  ADD COLUMN IF NOT EXISTS g10_school_udise_code varchar(11);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_tshirt_size_check') THEN
    ALTER TABLE student
      ADD CONSTRAINT student_tshirt_size_check
        CHECK (tshirt_size IS NULL OR tshirt_size IN ('XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
      ADD CONSTRAINT student_track_pant_size_check
        CHECK (track_pant_size IS NULL OR track_pant_size IN ('XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
      ADD CONSTRAINT student_g10_school_udise_code_check
        CHECK (g10_school_udise_code IS NULL OR g10_school_udise_code ~ '^[0-9]{11}$');
  END IF;
END
$$;
