# Accounts and learner sync

Hibiki uses **Better Auth 1.7.7**, pinned in `package.json`. D1 remains the primary production application database. Anonymous learner data stays browser-local. Authenticated users additionally synchronize eligible learner state to D1. Core practice does not require an account. Billing, subscriptions and saved vocabulary remain unimplemented.

## Authentication and runtime

Better Auth owns password hashing (its default scrypt), verification/reset tokens, Google OAuth state and PKCE, identity linking, session tokens and cookie signatures. Email registration requires email verification. Passwords must be 12–128 characters. Password reset revokes existing sessions. Verification and reset email use Resend through a server-only transport, with a 10-second delivery timeout. A missing email transport fails registration/reset explicitly rather than creating an unusable password account. Email links and tokens never enter diagnostics.

Google uses the framework's authorization-code flow and online access, without requesting offline refresh access. OAuth tokens are encrypted using the framework. Implicit same-email linking is **disabled**. Sign in with the existing method, then choose **Connect Google** from `/account` and authenticate with Google. Different emails cannot link, and an identity already belonging to another user cannot merge accounts. Google-only users can add password sign-in through the framework's email password-reset flow. Business logic uses only the stable `session.user.id` as `userId`.

Sessions last 14 days, rotate after one day, and use the framework's HttpOnly/SameSite=Lax cookies with Secure on HTTPS. Session cookie caching is disabled: authenticated data endpoints validate the database session each time. No session or OAuth token is stored in localStorage. Better Auth database-backed rate limits are enabled, including its email-login default and tighter registration, reset, verification resend and linking rules. Cloudflare's trusted `cf-connecting-ip` supplies the rate-limit identity. Auth logging is disabled so provider exceptions cannot leak credentials.

The canonical Worker intercepts `/api/auth/*`, `/api/account/*` and `/api/sync/*` **before vinext** and injects native `HIBIKI_DB`, origin and secrets into a request-local framework instance. It retains vinext's response-stage exports and all existing content handlers. This avoids framework-specific binding globals or a singleton containing a request's secrets. Auth uses native Web Request/Response APIs, with no Server Action cookie bridge. Next.js route handlers use the same boundaries and a durable local SQLite database at `.cloudflare/next-auth.sqlite` when explicitly configured; production never uses that file.

Compatibility evidence: Better Auth's [Next integration](https://better-auth.com/docs/integrations/next) documents Next.js 16 support. Installed `@better-auth/kysely-adapter` detects a native D1 binding, selects its D1 SQLite dialect, and disables SQL transactions that D1 does not support. `scripts/check-d1-runtime.mjs` tests the actual vinext production bundle in workerd with native D1: password hashing, registration, verification email delivery through mocked egress, session cookie, sync write and sign-out. Google state/PKCE/linking are exercised deterministically with the framework's Google adapter mocked; real Google credentials and a successful production callback are still required for production verification.

## Schema and API

`0001_shared_content.sql` is unchanged. `0002_auth.sql` was generated with Better Auth 1.7.7's `getMigrations` and reviewed as additive SQLite/D1 SQL. Its framework-owned tables are `user`, `account`, `session`, `verification`, and `rateLimit`. The generation script is `scripts/generate-auth-migration.ts`; do not overwrite an applied migration when upgrading the framework.

`0003_user_sync.sql` adds application-owned tables:

| Table | Purpose |
| --- | --- |
| `user_preferences` | Mode, speed, Studio Mode and Furigana, with schema version and update date |
| `user_lessons` | Safe lesson identity, title/author, source/content identity, position and revision-specific completion |
| `user_practice_sessions` | Existing validated PracticeSession, including activeByDay and section activity |
| `user_quiz_attempts` | Compact answer/result metadata, scoring and verification status, without evidence quotes |
| `user_bookmarks` | Revision-specific section identity/times and deletion tombstones |
| `user_difficulty_refs` | Existing compact DifficultyReference; no shared analysis duplicate |
| `user_practice_archives` | Frozen imports of anonymous retention summaries, keyed by device and transcript revision |

Every application row has queryable `user_id`, with a foreign key to `user.id` and cascade deletion. Composite primary keys provide owner-scoped indexed reads and idempotent upserts. Nested domain activity remains bounded JSON rather than a new incompatible model. Completion is stored inside `user_lessons`, rather than a separate table. Recent history is derived from its update dates.

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/account/me` | Minimal account identity and configured sign-in capabilities; never session/token fields |
| `GET /api/sync/bootstrap?cursor=…` | At most 50 rows from one collection plus preferences, with an opaque keyset cursor |
| `POST /api/sync/push` | Streaming body limit 512 KB; at most 50 records per collection; strict domain/allowlist validation |
| `GET /api/sync/lesson?id=…` | Restore an account-owned reference from matching trusted public YouTube captions; 404 when content must be reattached |

All ownership comes from a validated session. A browser-supplied `userId` is rejected as an unknown field, not used as authorization. Every application query includes the owner. Browser sync requests include an expected-account header; a mismatch with the session returns 409 so an old tab cannot upload its previous account's cache after another tab changes accounts. This header never grants access. Writes require the configured origin and JSON Content-Type. Framework origin checks remain enabled for auth; return paths are restricted to `/`, `/account`, `/sign-in`, and `/reset-password`. Account/auth responses use `no-store`. Unauthenticated sync returns 401; an unavailable database or transport returns a retryable error without logging request data.

Quiz input uses existing domain constraints and sends selected answers plus compact results/times, **never a transcript evidence quote**. When the referenced trusted quiz is available in `generated_artifacts`, its questions are validated against the trusted transcript and scores/results are recomputed on the server. The exact authored demo is also scored server-side. Private quizzes and evicted/older shared quiz generations have no server answer key; their internally consistent history is explicitly stored as `verified=false` (self-reported). Such history is learner feedback, not an entitlement, credential or leaderboard score. Rehydration uses the existing QuizAttempt model; missing evidence text is represented by a device-availability note. Full private evidence remains on its original device.

## Local-first operation and first sign-in

Local interaction writes remain immediate. A sync service observes only learner-storage writes, debounces remote work, and persists compact retry state locally before any request. Playback never awaits sync. A failed push leaves local progress intact; account UI shows that it is waiting to sync. Retry occurs on reconnect, focus/visibility, a visible-page minute timer, the next edit or **Sync now**. Only changed records are pushed in batches of 20, using stable IDs. Remote records hydrate the existing learner model and `aggregateProfile()`; sessions are not counted twice.

Anonymous `hibiki:v1:` keys and payloads remain compatible. Account-owned learner keys live under `hibiki:v1:account:<userId>:`. A persisted `active-account` value selects a local cache across page loads; it is **not authentication** and cannot authorize network writes. Sign-out restores anonymous keys. Lesson/transcript/translation caches remain device-only. Account-only lesson markers prevent anonymous legacy backfill from fabricating history from a signed-in account's visits.

On first successful sign-in with anonymous state, the UI asks **“Add this device's Hibiki progress to your account?”**. A compact candidate snapshot is frozen locally. It is never pushed before acceptance. Accept merges eligible preferences, safe lesson references, sessions, attempts, bookmarks, completions, difficulties and frozen retention archives. IDs make retry idempotent; per-account device decision/completion markers prevent repeated import. Decline retains anonymous data and does not upload it. New authenticated practice still syncs independently. Neither choice deletes local history.

Anonymous retention compaction is unchanged. Account history retains immutable session IDs rather than creating overlapping per-device compaction archives. The existing local history byte guard and storage-failure warning still apply; large account caches can require a future bounded local cache/window, while D1 keeps the remote history. Server responses are paginated, but the initial client currently traverses the history pages to hydrate the local aggregate. This is a scale limitation, not unbounded server response behaviour.

## Merge rules

| Record | Rule |
| --- | --- |
| Preferences | Latest `updatedAt` wins; old preferences without dates use the epoch and cannot overwrite dated account preferences |
| Bookmarks | Union by lesson/transcript/section identity; latest dated state wins; deletion wins timestamp ties |
| Practice sessions | Immutable UUID and lesson/revision identity; latest valid version wins, no summation of duplicate UUIDs |
| Quiz attempts | Immutable attempt ID; latest version wins; separate retakes remain separate; equal-date server-normalized scoring wins |
| Completion | Completed is monotonic for the same transcript revision, even when position is stale |
| Last position | Latest date for matching transcript revision; never applied to a different revision |
| Difficulty | Latest `generatedAt` for the validated compact identity |
| Imported archives | Immutable device/revision snapshot; first insertion wins, retries cannot add its totals again |

Incoming dates more than five minutes in the future are rejected. IDs cannot change their lesson/revision ownership. Edits made during an in-flight sync are preserved and queued for another pass.

## Privacy and portability

Synced metadata includes lesson title/author, stable lesson/content/provider identities, duration/count, last section/position, practice dates/completion, active time/day totals, section replay/reveal/recording **counts**, quiz selected answers/results, bookmark times/deletion state and compact difficulty dimensions. Metadata containing URLs or local paths is excluded/rejected rather than uploaded.

These remain browser-only: audio blobs/recordings, translation cache, transient reveal state, object URLs, local media bytes/paths, signed direct URLs, Vimeo access hashes, authorization headers, user-imported/pasted transcript text, private quiz/evidence text and Whisper inputs. Safe content keys may be hashes, but never raw playback URLs. Public YouTube lessons can be restored only when a trusted hosted transcript matches the stored revision. Direct/Vimeo/local media and private transcript lessons require reattachment on another device; their learning metadata is still available. Shared cache trust and inference behaviour are unchanged.

Future account deletion should revoke auth sessions, delete the framework user/accounts/verification records as appropriate, and delete every owned row by `user_id` (application foreign keys cascade). A future settings API must authenticate and reauthenticate before deletion. Clear the local account cache on each device when appropriate. Never delete shared public transcripts or generated artifacts merely because one account is deleted.

## Production setup and release gate

Production origin: `https://shadowing.julianpopovskijones.workers.dev`.

Google web OAuth authorized JavaScript origin: the production origin. Authorized redirect URI:

`https://shadowing.julianpopovskijones.workers.dev/api/auth/callback/google`

For local OAuth, add `http://localhost:3000` and `http://localhost:3000/api/auth/callback/google` to the existing Google client. Preview origins must be explicitly configured in their own environment; arbitrary origins and wildcard callbacks are not accepted.

Cloudflare secret names only: `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`. `AUTH_BASE_URL` is a non-secret typed text binding. Keep `AUTH_SECRET` stable (at least 32 random characters); rotating it affects sessions and encrypted provider tokens. Use the existing cf CLI's secret command or the Worker dashboard, never Git or chat. Resend requires a verified sending domain and a sender address, such as `Hibiki <accounts@your-domain>`. The connected account currently has no sender domain; production email delivery requires user setup. The Google secrets are configured and the user confirmed the production redirect URI is allowed. A real OAuth callback must still be verified.

Local Next development can set the same names in ignored `.env.local`, with `AUTH_BASE_URL=http://localhost:3000`. Demo/import/anonymous practice need none of them. Standard Next does not silently create an authentication secret or a test mail sink.

Release ordering: commit migrations → apply D1 migrations → configure secrets → deploy built Worker → run real email/Google/two-device smoke tests. `npm run deploy:vinext` still gates deployment on `db:migrate:production`. Do not reset D1. Do not claim real Google verification based on a mocked test. Record each actual production smoke result before merging.

Verification commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`, `npm run build`, `npm run build:vinext`, `npm run test:d1:runtime`, and Playwright on both production runtimes. `tests/accounts-sync.test.ts` covers actual local D1/auth, session/expiry, user isolation, malicious ownership, state/PKCE/linking, score recomputation, conflicts and pagination. `tests/e2e/accounts.spec.ts` covers explicit import/decline/retry, privacy exclusions, two browser devices, preference/bookmark/completion/retake continuity, and offline playback/local writes with mocked account transport. CI never contacts live Google or sends real emails.
