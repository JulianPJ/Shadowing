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

After the full browser runs, the stale-account header guard was added and covered by the actual D1 integration test. All three account browser flows passed again on both rebuilt runtimes. Test outputs and screenshots remain in ignored `artifacts/`; no credentials, email action links or session cookies are printed.

## Production results

Production release attempted on 2026-10-05:

| Check | Result |
| --- | --- |
| Commit before migrations | Implementation and migrations committed as `d384317`; current `origin/main` integrated into the feature branch |
| Production D1 migrations | `0002_auth.sql` and `0003_user_sync.sql` applied successfully; remote ledger contains all three migrations and all expected tables |
| Secret configuration | `AUTH_SECRET` generated directly inside the Cloudflare connector; Google secret names confirmed present; the user confirmed callback configuration |
| Existing secret version | Activated the dashboard's Google-secret version after confirming its script ETag matches the previous deployment; this did not deploy account code |
| New account Worker deployment | **Blocked** by the CLI's missing-required-secrets check for `RESEND_API_KEY` and `AUTH_EMAIL_FROM`; no account Worker version was deployed |
| Production email auth | Not run; provider/sender configuration required |
| Production Google callback | Not verified; must run after the account Worker is deployed |
| Authenticated second device and sign-out smoke | Not run; depend on a real production account |

The deployment's initial strict D1 display-name mismatch came from the dashboard secret version, which retained the same database UUID but omitted its display name. Removing only that optional display name from the ignored prebuilt Worker metadata allowed the strict check to advance to the missing email secrets. The source configuration and D1 database identity are unchanged. A fresh build after another dashboard secret update may require the same metadata normalization.

Next steps: configure a verified Resend sender and the two missing secret names, deploy the built Worker, complete real email and Google login, then verify a small progress write/read on two independent browser sessions and rejection after sign-out. No mock or direct database-created identity is acceptable evidence of those real-provider checks.

The requested merge to `main` is authorized, conditional on completing the release checks above.
