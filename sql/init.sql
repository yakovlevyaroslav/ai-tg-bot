CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  welcome_bonus_granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS welcome_bonus_granted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS specialist TEXT
    CHECK (specialist IS NULL OR specialist IN ('tarolog', 'numerolog', 'rodolog'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB NOT NULL DEFAULT '{}';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS start_payload TEXT;

CREATE TABLE IF NOT EXISTS user_start_payloads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_start_payload
  ON users (start_payload)
  WHERE start_payload IS NOT NULL AND start_payload <> '';

CREATE INDEX IF NOT EXISTS idx_user_start_payloads_user_created
  ON user_start_payloads (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_start_payloads_payload
  ON user_start_payloads (payload);

CREATE TABLE IF NOT EXISTS balances (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits BIGINT NOT NULL DEFAULT 0 CHECK (credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('grant', 'spend', 'refund', 'purchase', 'bonus')),
  idempotency_key TEXT UNIQUE,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_user_created
  ON token_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id BIGINT REFERENCES token_transactions(id) ON DELETE SET NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  credits_charged BIGINT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_created
  ON messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_code TEXT NOT NULL UNIQUE,
  rub_amount INT NOT NULL CHECK (rub_amount > 0),
  credits_amount BIGINT NOT NULL CHECK (credits_amount > 0),
  provider TEXT NOT NULL DEFAULT 'manual'
    CHECK (provider IN ('manual', 'yookassa')),
  external_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE pending_payments
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE pending_payments
  ADD COLUMN IF NOT EXISTS external_payment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_payments_external_id
  ON pending_payments (external_payment_id)
  WHERE external_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_payments_user_status
  ON pending_payments (user_id, status);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  step TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON analytics_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_step_created
  ON analytics_events (step, created_at DESC);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personality_code TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS visit_card_published BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS visit_card_published_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS visit_card_content TEXT;

UPDATE users u
SET personality_code = u.onboarding_data->>'personality_code'
WHERE u.personality_code IS NULL
  AND COALESCE(u.onboarding_data->>'personality_code', '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM users u2
    WHERE u2.id <> u.id
      AND u2.personality_code = u.onboarding_data->>'personality_code'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_personality_code_unique
  ON users (personality_code)
  WHERE personality_code IS NOT NULL;

ALTER TABLE pending_payments
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'topup';

ALTER TABLE pending_payments
  DROP CONSTRAINT IF EXISTS pending_payments_credits_amount_check;

ALTER TABLE pending_payments
  ADD CONSTRAINT pending_payments_credits_amount_check CHECK (credits_amount >= 0);

ALTER TABLE pending_payments
  DROP CONSTRAINT IF EXISTS pending_payments_product_type_check;

ALTER TABLE pending_payments
  ADD CONSTRAINT pending_payments_product_type_check
    CHECK (product_type IN ('topup', 'visit_card'));

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  message_text TEXT NOT NULL DEFAULT '',
  parse_mode TEXT NOT NULL DEFAULT 'HTML',
  photo_url TEXT,
  photo_file_id TEXT,
  reply_markup JSONB,
  filters JSONB NOT NULL DEFAULT '{}',
  sort_order TEXT NOT NULL DEFAULT 'created_at_desc',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'queued', 'running', 'paused', 'completed', 'cancelled')),
  total_recipients INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_description TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_status
  ON broadcast_campaigns (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_scheduled
  ON broadcast_campaigns (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_campaign_status
  ON broadcast_deliveries (campaign_id, status);

ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS photo_file_id TEXT;

ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

ALTER TABLE broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_status_check;

ALTER TABLE broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'queued', 'running', 'paused', 'completed', 'cancelled'));

CREATE TABLE IF NOT EXISTS broadcast_button_questions (
  id BIGSERIAL PRIMARY KEY,
  question_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
