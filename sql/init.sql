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
  ADD COLUMN IF NOT EXISTS provider TEXT;

UPDATE pending_payments SET provider = 'manual' WHERE provider IS NULL;

ALTER TABLE pending_payments
  ALTER COLUMN provider SET DEFAULT 'manual';

ALTER TABLE pending_payments
  ALTER COLUMN provider SET NOT NULL;

ALTER TABLE pending_payments
  ADD COLUMN IF NOT EXISTS external_payment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_payments_external_id
  ON pending_payments (external_payment_id)
  WHERE external_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_payments_user_status
  ON pending_payments (user_id, status);
