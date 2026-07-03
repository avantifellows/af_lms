ALTER TABLE user_permission
ADD COLUMN IF NOT EXISTS user_id BIGINT,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

ALTER TABLE teacher
ADD COLUMN IF NOT EXISTS exit_date DATE;

UPDATE user_permission up
SET user_id = u.id
FROM "user" u
WHERE up.user_id IS NULL
  AND LOWER(up.email) = LOWER(u.email);

CREATE INDEX IF NOT EXISTS idx_user_permission_user_id
ON user_permission(user_id);

CREATE INDEX IF NOT EXISTS idx_user_permission_active_email
ON user_permission(LOWER(email))
WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS centre_option_sets (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL,
  allow_multi BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS centre_options (
  id BIGSERIAL PRIMARY KEY,
  option_set_id BIGINT NOT NULL REFERENCES centre_option_sets(id),
  code VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE(option_set_id, code)
);

CREATE TABLE IF NOT EXISTS centres (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  school_id BIGINT REFERENCES school(id),
  type_code VARCHAR(50),
  category_code VARCHAR(50),
  sub_category_code VARCHAR(50),
  stream_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  program_id INTEGER,
  is_physical BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_centres_school_id
ON centres(school_id);

CREATE TABLE IF NOT EXISTS centre_positions (
  id BIGSERIAL PRIMARY KEY,
  centre_id BIGINT NOT NULL REFERENCES centres(id),
  role VARCHAR(50) NOT NULL,
  user_id BIGINT REFERENCES "user"(id),
  hr_code VARCHAR(255),
  notes TEXT,
  deleted_at TIMESTAMP,
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_centre_positions_user_active
ON centre_positions(user_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_centre_positions_centre_active
ON centre_positions(centre_id)
WHERE deleted_at IS NULL;
