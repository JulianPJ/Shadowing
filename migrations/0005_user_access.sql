-- App-owned entitlement state. Missing rows are treated as Free so existing accounts need no backfill.
CREATE TABLE user_access (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','test','paddle','stripe')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX user_access_provider_subscription
  ON user_access(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
