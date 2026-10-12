-- Keep manual/test plans intact and project paid access into the existing single-row lookup.
ALTER TABLE user_access ADD COLUMN paddle_sandbox_until TEXT;
ALTER TABLE user_access ADD COLUMN paddle_live_until TEXT;

CREATE TABLE billing_checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  price_id TEXT NOT NULL,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX billing_checkout_transaction ON billing_checkouts(environment, transaction_id);
CREATE INDEX billing_checkout_user ON billing_checkouts(user_id, environment, expires_at);

CREATE TABLE billing_customers (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  customer_id TEXT NOT NULL,
  PRIMARY KEY(user_id, environment),
  UNIQUE(environment, customer_id)
);

CREATE TABLE billing_subscriptions (
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  subscription_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','trialing','past_due','paused','canceled')),
  period_start TEXT,
  period_end TEXT,
  cancel_at TEXT,
  last_event_at TEXT NOT NULL,
  PRIMARY KEY(environment, subscription_id),
  FOREIGN KEY(user_id, environment) REFERENCES billing_customers(user_id, environment) ON DELETE CASCADE
);
CREATE INDEX billing_subscription_user ON billing_subscriptions(user_id, environment, status);

-- A processing token gates all writes in the same D1 batch. No partial deduplication commits.
CREATE TABLE billing_events (
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(environment, event_id)
);

-- Kept independently so a refund arriving before subscription.created is still effective.
CREATE TABLE billing_adjustments (
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  adjustment_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  period_end TEXT NOT NULL,
  revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
  last_event_at TEXT NOT NULL,
  PRIMARY KEY(environment, adjustment_id)
);
CREATE INDEX billing_adjustment_subscription ON billing_adjustments(environment, subscription_id, revoked, period_end);
