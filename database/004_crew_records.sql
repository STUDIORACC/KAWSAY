-- Every record the crew and physician create in the interface (basal, daily check-ins, symptoms, alerts, emergency
-- reports, Earth reports and AI notes). One row per record_id; the client sends the full record and the newest "_u" wins.
-- Synthetic data only in this MVP.
CREATE TABLE kawsay.crew_records (
  mission_id text NOT NULL REFERENCES kawsay.missions,
  record_id text NOT NULL CHECK (record_id ~ '^[A-Za-z0-9._-]{8,64}$'),
  synthetic boolean NOT NULL CHECK (synthetic),
  crew_id text NOT NULL CHECK (crew_id ~ '^[A-Za-z0-9_-]{1,16}$'),
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 32),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND pg_column_size(payload) <= 16384),
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','reviewed','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, record_id)
);
CREATE INDEX crew_records_by_crew ON kawsay.crew_records (mission_id, crew_id, updated_at DESC);
INSERT INTO kawsay.schema_migrations(version) VALUES ('004_crew_records');
