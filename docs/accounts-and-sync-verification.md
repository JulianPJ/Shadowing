# Accounts and sync release verification

Implementation uses **Better Auth 1.7.7**, with verified email/password, password reset, Google OAuth and explicit identity linking. Its native D1 adapter was exercised inside the actual vinext production bundle in local workerd, including password hashing, verification, secure cookie sessions, sync and sign-out. Email delivery and Google exchanges in deterministic tests are mocked; these are not real-provider production verification.

The [account design](accounts-and-sync.md) documents the framework tables (`user`, `account`, `session`, `verification`, `rateLimit`), seven app-owned sync tables, merge rules, exact synced/local-only fields, explicit first-login import and security boundaries. Migrations are `0002_auth.sql` and `0003_user_sync.sql`; the existing shared-content migration is unchanged. Secret names and Google callback are documented there without credential values.

## Deterministic results

Run with Node 24.21.0 and installed Chrome:

| Check | Result |
| --- | --- |
| Unit/integration | 133 passed; includes actual D1 migrations, ownership/isolation, stale-account tab rejection, email verification/reset/session revocation, mocked Google state/PKCE/linking, forged scoring, bounded pagination and pretransport privacy |
| Next production browser suite | 45 passed |
| Cloudflare production preview browser suite | 45 passed with remote bindings disabled and deterministic provider boundaries |
| Two-device browser flow | Passed import/decline/idempotence, preferences, bookmark deletion, completion, retakes, offline playback and retry without duplicates |
| Next production build | Passed |
| vinext/Cloudflare production build | Passed; dependency dynamic-import warnings remain |
| Built Worker + local D1 | Passed actual auth/session/progress round trip and existing prepare/quiz/difficulty miss/save/hit checks |
| Typecheck, lint, formatting | Passed |

After the full browser runs, the stale-account header guard was added and covered by the actual D1 integration test. Account browser flows are rerun on both rebuilt runtimes before deployment. Test outputs and screenshots remain in ignored `artifacts/`; no credentials, email action links or session cookies are printed.

## Production results

Pending migration, secret and deployment verification. Google credentials are present; the user confirmed the callback is configured. Email sender configuration is pending (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`). Real email, real Google callback and authenticated second-device smoke results must be recorded before merge. Anonymous practice remains available without these credentials.

The requested merge to `main` is authorized, conditional on completing the release checks above.
