-- Optional study limits preserve all existing account preferences and rows.
ALTER TABLE user_preferences ADD COLUMN review_limits_json TEXT;
