-- Production QA accounts for exercising Free vs Pro entitlement behavior before billing is wired.
-- Passwords are not stored in plaintext. These are Better Auth-compatible scrypt hashes.
-- Remove/rotate these accounts when they are no longer required.

INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
VALUES (
  '2b3c0bb9-ad1a-4df0-97c7-af55a0a9a06a',
  'Hibiki Free Test',
  'hibiki-free-test@example.com',
  1,
  NULL,
  1791294631535,
  1791294631535
);

INSERT OR IGNORE INTO account (
  id, accountId, providerId, userId, accessToken, refreshToken, idToken,
  accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
)
VALUES (
  '1413d5e0-e159-43f3-9172-ec8060f3abe9',
  '2b3c0bb9-ad1a-4df0-97c7-af55a0a9a06a',
  'credential',
  '2b3c0bb9-ad1a-4df0-97c7-af55a0a9a06a',
  NULL, NULL, NULL, NULL, NULL, NULL,
  'bf23f723928e2ad033d2e4ca94d2be0b:ae173c9ccd261a83b920b52f0948466644d25e1d5749501e957fd5ded143570e008736b5179ff4b6fedae904b8b5dfbe58f88e0bdf8c3b5355ebffd7d2bcefa6',
  1791294631535,
  1791294631535
);

INSERT INTO user_access (user_id, plan, source, updated_at)
VALUES (
  '2b3c0bb9-ad1a-4df0-97c7-af55a0a9a06a',
  'free',
  'test',
  '2026-10-06T13:50:31Z'
)
ON CONFLICT(user_id) DO UPDATE SET
  plan = excluded.plan,
  source = excluded.source,
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
VALUES (
  'b6d5d358-9b94-469e-9a78-cfd3164ac21c',
  'Hibiki Pro Test',
  'hibiki-pro-test@example.com',
  1,
  NULL,
  1791294631535,
  1791294631535
);

INSERT OR IGNORE INTO account (
  id, accountId, providerId, userId, accessToken, refreshToken, idToken,
  accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
)
VALUES (
  'de349d61-9afd-42f4-bb04-b5846664d732',
  'b6d5d358-9b94-469e-9a78-cfd3164ac21c',
  'credential',
  'b6d5d358-9b94-469e-9a78-cfd3164ac21c',
  NULL, NULL, NULL, NULL, NULL, NULL,
  'd99c7d0d2e51c0d459a6351b65fc78e9:05e1905fc79be6f9d34ce0303021026d969341dc7a1512180d778800c9b339354e27202f5de38701480368c83564ccf9d277ee3b4655471e5032d48ca066db92',
  1791294631535,
  1791294631535
);

INSERT INTO user_access (user_id, plan, source, updated_at)
VALUES (
  'b6d5d358-9b94-469e-9a78-cfd3164ac21c',
  'pro',
  'test',
  '2026-10-06T13:50:31Z'
)
ON CONFLICT(user_id) DO UPDATE SET
  plan = excluded.plan,
  source = excluded.source,
  updated_at = excluded.updated_at;
