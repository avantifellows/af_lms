ALTER TABLE lms_pm_school_visits
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS lms_pm_visit_actions (
  id BIGSERIAL PRIMARY KEY,
  visit_id BIGINT NOT NULL REFERENCES lms_pm_school_visits(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  deleted_at TIMESTAMP,
  started_at TIMESTAMP,
  start_lat DECIMAL(10, 8),
  start_lng DECIMAL(11, 8),
  start_accuracy DECIMAL(10, 2),
  ended_at TIMESTAMP,
  end_lat DECIMAL(10, 8),
  end_lng DECIMAL(11, 8),
  end_accuracy DECIMAL(10, 2),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  CONSTRAINT lms_pm_visit_actions_deleted_pending_check
    CHECK (deleted_at IS NULL OR status = 'pending'),
  CONSTRAINT lms_pm_visit_actions_status_timestamps_check
    CHECK (
      (status = 'pending'     AND started_at IS NULL AND ended_at IS NULL) OR
      (status = 'in_progress' AND started_at IS NOT NULL AND ended_at IS NULL) OR
      (status = 'completed'   AND started_at IS NOT NULL AND ended_at IS NOT NULL)
    ),
  CONSTRAINT lms_pm_visit_actions_time_order_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  data JSONB DEFAULT '{}'::jsonb,
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_visit_actions_visit_id
ON lms_pm_visit_actions(visit_id);
