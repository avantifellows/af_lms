ALTER TABLE lms_pm_school_visits
DROP COLUMN IF EXISTS data;

ALTER TABLE lms_pm_school_visits
DROP COLUMN IF EXISTS ended_at;

DROP INDEX IF EXISTS lms_pm_school_visits_ended_at_index;
