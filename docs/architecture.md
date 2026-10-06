# Code navigation

Hibiki runs on Cloudflare Workers via vinext. Standard Next.js is also supported for local development and verification. Read `PROJECT_CONTEXT.md` for product decisions and the installed Next.js documentation before changing framework code.

| Concern | Implementation |
| --- | --- |
| Practice hydration / missing lesson | `src/components/practice.tsx` |
| Player state, navigation, recording / quiz coordination | `src/components/practice/study-player.tsx` |
| Current section and playback buttons | `src/components/practice/current-section.tsx` |
| Transcript filtering and automatic scrolling | `src/components/practice/transcript-panel.tsx` |
| Playback boundaries, seek tolerance, evidence replay | `src/components/practice/use-playback-boundary.ts`, `src/lib/section-lookup.ts` |
| Translation request, cancellation, reveal and browser cache | `src/components/practice/use-section-translation.ts` |
| Practice clock and checkpoints | `src/components/use-practice-progress.ts`, `src/lib/practice-clock.ts`, `src/lib/practice-checkpoint.ts` |
| Progress page loading and cross-tab refresh | `src/components/use-learner-profile.ts` |
| Learner validation, sessions, retention, aggregation, migration | `src/lib/learner/` |
| Browser persistence, lessons, preferences, learning records | `src/lib/storage/` |
| Framework-owned authentication, cookie sessions and local Next adapter | `src/lib/auth/` |
| Account sync contract, validation, merge, D1 repository and browser hydration | `src/lib/sync/` |
| Dictionary identity/context and safe replay links | `src/lib/dictionary/` |
| Dictionary cursor/filter and exact-ID queries, account-scoped record cache | `src/lib/dictionary/query.ts`, `repository.ts`, `cache.ts`, `client.ts` |
| Descriptive tags, ownership, limits and connected edits | `src/lib/tags/`, `src/components/tag-controls.tsx` |
| Composed completion recap and explainable revisit evidence | `src/components/lesson-completion-summary.tsx`, `src/lib/lesson-completion.ts` |
| Collections and entry memberships | `src/lib/decks/`, `src/lib/review/repository.ts` |
| Pure scheduling, local review outbox and authenticated D1 review | `src/lib/review-scheduler.ts`, `src/lib/review/` |
| Exportable vocabulary rows and spreadsheet-safe CSV | `src/lib/export/vocabulary.ts` |
| Optional account UI and first-login import prompt | `src/components/account.tsx`, `src/components/auth-form.tsx` |
| Transcript validation and identity | `src/lib/transcript.ts`, `src/lib/transcript-validation.ts`, `src/lib/hash.ts` |
| Quiz questions, documents and attempts | `src/lib/quiz/` |
| Quiz configuration, prompts, selection and provider adapters | `src/lib/providers/quiz/` |
| Request envelope / browser POST transport | `src/lib/content-request.ts` |
| Trusted transcript matching and shared artifact cache | `src/lib/shared-content.ts` |
| Bounded streamed bodies | `src/lib/http-body.ts` |
| Ordered global styles | `src/app/globals.css`, `src/app/styles/` |
| Cloudflare runtime routing and inferred binding types | `cloudflare-worker.js`, `cloudflare.config.ts` |

`storage.ts`, `learner-progress.ts`, `learner-storage.ts`, `quiz.ts` and `providers/quiz.ts` retain their existing exports as compatibility facades. Internal modules should import the specific module they need, especially for transcript utilities that are also used outside quizzes. Avoid importing server providers into client components.

## Behaviour to preserve

- Keep the same mounted media player when changing display preferences. Browser recordings, local object URLs and the media adapter belong to the active practice tree.
- Preserve playback tolerances and automatic pause timing. `section-lookup.ts` reproduces the original predicate, including gaps and legacy ordering.
- Keep the `hibiki:v1:` keys and existing JSON formats. Lesson history and quiz attempts retain all existing compatibility rules; unchanged lesson payloads skip redundant writes. Failed writes still retain visit data in memory and show the existing warning.
- Transcript hashes include section IDs, timing and trimmed Japanese text; media URLs are excluded. Model selection thresholds, prompts, inference options and evidence validation are unchanged.
- Styles are imported in their original cascade order. Later responsive and display rules intentionally override earlier rules. Do not merge distant duplicate selectors without checking intervening declarations.
- Preserve vinext's response-stage exports in the Worker wrapper, Cloudflare bindings, provider fallback and D1 fail-open behaviour.

## Verification

Use Node 24, as declared in `package.json`. Install dependencies with `npm ci`; on Windows PowerShell use `npm.cmd` / `npx.cmd` if script execution policy blocks the `.ps1` shims.

| Change | Checks |
| --- | --- |
| General code | `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check` |
| Playback or persistence | Existing browser tests plus `tests/refactoring.test.ts` |
| Next.js integration | `npm run build`; start with `npm start`, then `npm run test:e2e` |
| Canonical Cloudflare runtime | `npm run build:vinext`, `npm run test:d1:runtime`; browser tests against local preview |
| Caption relay | Included in `typecheck`; `npm run build:caption-relay` for bundling |

Browser tests use `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`). Set `PLAYWRIGHT_CHROME_PATH` to an installed Chrome executable when Playwright's bundled browser is unavailable. D1 unit and built-runtime tests use local storage and mocked providers, without contacting live AI/caption services.

`npm run start:vinext:test` serves the built Worker at port 3001 with remote bindings and persistent state disabled. Run the full browser suite with `PLAYWRIGHT_BASE_URL=http://localhost:3001`. CI now verifies both production runtimes, local migrations and the built native Worker/D1 boundary on the same PR head. Focused retention checks: `tests/retention-scale.test.ts` (650 real D1 entries and populated upgrade), `tests/dictionary-cache.test.ts`, `tests/lesson-completion.test.ts`, and `tests/e2e/retention-polish.spec.ts` (806-word browser export/offline hydration).

Interactive dictionary consumers must use `page()` or `byIds()`. Full traversal is an explicit export/compatibility operation, never the Daily Review join or lesson recap default. Cache and query contracts live in [retention](retention-implementation.md). Scheduling remains in `review/`; tags never own or copy schedules. The completion component composes domain outputs without adding player state or AI generation effects.

`npm run format` provides reproducible formatting. Generated assets, build output, lockfiles and authored demo data are excluded. Formatting increases physical line counts; evaluate simplification by ownership and duplicated logic rather than line count alone.

The refactor was verified on 2026-10-04 with 123 passing unit tests (including Node 24), 42 passing browser tests on each runtime, both app builds, the relay build, and the built Worker/D1 integration check. The original CSS and all compatibility-facade exports were compared directly against the pre-refactor revision. Browser/provider boundaries use deterministic mocks or authored demo data; these checks do not exercise live AI or caption services.

Lesson-history normalization and a new incremental quiz-attempt format remain separate migration work. This refactor retains the existing stored formats and all attempt records, and reduces redundant lesson writes without migrating browser data.
