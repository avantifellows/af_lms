ALTER TABLE lms_pm_school_visits
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP(0) NULL;
