-- Mirrors db-service 20260928120000_create_lms_usage_events_table.exs
CREATE TABLE IF NOT EXISTS public.lms_usage_events (
  id bigserial PRIMARY KEY,
  event varchar(50) NOT NULL,
  email varchar(255) NOT NULL,
  role varchar(50),
  school_code varchar(20),
  centre_id bigint,
  detail varchar(255),
  meta jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamp(0) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  event_date date NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
  CONSTRAINT event_constraint CHECK (event IN ('sign_in', 'combined_report_requested', 'tab_viewed'))
);
CREATE INDEX IF NOT EXISTS lms_usage_events_event_event_date_index ON public.lms_usage_events (event, event_date);
CREATE INDEX IF NOT EXISTS lms_usage_events_email_index ON public.lms_usage_events (email);
CREATE UNIQUE INDEX IF NOT EXISTS lms_usage_events_tab_daily_unique ON public.lms_usage_events
  (email, detail, event_date, COALESCE(school_code, ''), COALESCE(centre_id, 0))
  WHERE event = 'tab_viewed';
