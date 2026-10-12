-- AI Agent prototype schema (PostgreSQL 15+)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'awaiting_confirmation', 'succeeded', 'failed', 'cancelled');
CREATE TYPE run_event_type AS ENUM ('user_message', 'assistant_message', 'tool_requested', 'tool_result', 'tool_error', 'approval_requested', 'approval_decided', 'system_error');
CREATE TYPE approval_state AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE feedback_rating AS ENUM ('helpful', 'not_helpful');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  instructions text NOT NULL,
  scope_description text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{"max_turns":6,"max_tool_calls":4,"model_timeout_seconds":45}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_configs_name_version_unique UNIQUE (name, version),
  CONSTRAINT agent_configs_settings_object CHECK (jsonb_typeof(settings) = 'object')
);
CREATE UNIQUE INDEX agent_configs_one_active_per_name ON agent_configs(name) WHERE is_active;

CREATE TABLE tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  adapter_key text NOT NULL,
  input_schema jsonb NOT NULL,
  consequential boolean NOT NULL DEFAULT false,
  timeout_seconds integer NOT NULL DEFAULT 15 CHECK (timeout_seconds BETWEEN 1 AND 300),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tools_schema_object CHECK (jsonb_typeof(input_schema) = 'object')
);

CREATE TABLE agent_tools (
  agent_config_id uuid NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT true,
  per_run_limit integer CHECK (per_run_limit IS NULL OR per_run_limit > 0),
  config_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (agent_config_id, tool_id),
  CONSTRAINT agent_tools_overrides_object CHECK (jsonb_typeof(config_overrides) = 'object')
);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_config_id uuid NOT NULL REFERENCES agent_configs(id) ON DELETE RESTRICT,
  status run_status NOT NULL DEFAULT 'queued',
  request_text text NOT NULL,
  response_text text,
  error_code text,
  error_message text,
  model_key text,
  model_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_call_count integer NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT runs_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);
CREATE INDEX runs_user_history_idx ON runs(user_id, created_at DESC);
CREATE INDEX runs_status_queue_idx ON runs(status, created_at) WHERE status IN ('queued', 'running', 'awaiting_confirmation');
CREATE INDEX runs_config_history_idx ON runs(agent_config_id, created_at DESC);
CREATE UNIQUE INDEX runs_correlation_id_idx ON runs(correlation_id);

CREATE TABLE run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  event_type run_event_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_events_sequence_unique UNIQUE (run_id, sequence_no),
  CONSTRAINT run_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX run_events_order_idx ON run_events(run_id, sequence_no);

CREATE TABLE run_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating feedback_rating NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_feedback_one_per_user UNIQUE (run_id, user_id)
);
CREATE INDEX run_feedback_chronology_idx ON run_feedback(created_at DESC);

CREATE TABLE evaluation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_config_id uuid REFERENCES agent_configs(id) ON DELETE CASCADE,
  name text NOT NULL,
  input_text text NOT NULL,
  expected_behavior jsonb NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_expected_object CHECK (jsonb_typeof(expected_behavior) = 'object')
);
CREATE INDEX evaluation_cases_active_idx ON evaluation_cases(agent_config_id, category) WHERE is_active;

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  initiated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  tool_key text NOT NULL REFERENCES tools(key) ON DELETE RESTRICT,
  arguments jsonb NOT NULL,
  arguments_sha256 text NOT NULL CHECK (arguments_sha256 ~ '^[0-9a-f]{64}$'),
  state approval_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_decision_consistency CHECK (
    (state = 'pending' AND decided_at IS NULL AND decided_by IS NULL) OR
    (state <> 'pending' AND decided_at IS NOT NULL)
  )
);
CREATE INDEX approvals_pending_idx ON approvals(initiated_by, expires_at) WHERE state = 'pending';
CREATE INDEX approvals_run_idx ON approvals(run_id, created_at);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_chronology_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log(target_type, target_id, created_at DESC);

-- Credentials belong in a secret manager. adapter_key and secret references are not secret values.
