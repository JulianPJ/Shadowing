# Code navigation

Hibiki is one Cloudflare Worker built with vinext (Next.js App Router on Vite). `vite dev` runs the Worker with its bindings, so development, preview, CI and production share a runtime. Read `PROJECT_CONTEXT.md` for product decisions, and the installed Next.js documentation before changing framework code.

## Where things live

| Concern | Implementation |
| --- | --- |
| Header, section tabs, help, task return | `src/components/chrome.tsx`, `src/components/task-return.ts` |
| Home: start a lesson, continue, Discover / Library tabs | `src/components/home.tsx`, `src/components/discover/`, `src/components/my-library.tsx`, `src/components/library-preview.tsx` |
| Vocabulary: Daily Review and Words | `src/components/daily-review.tsx`, `src/components/vocabulary-words.tsx`, `src/components/vocabulary-header.tsx` |
| Profile: progress, weekly report, account settings | `src/components/learner-progress.tsx`, `src/components/weekly-report.tsx`, `src/components/account.tsx` |
| Practice hydration / missing lesson | `src/components/practice.tsx` |
| Player state, navigation, recording and quiz coordination | `src/components/practice/study-player.tsx` |
| Practice toolbar and advanced settings | `src/components/practice/practice-settings.tsx`, `src/lib/drill-presets.ts` |
| Current section, transcript, elapsed-time store | `src/components/practice/current-section.tsx`, `transcript-panel.tsx`, `elapsed-store.ts` |
| Playback boundaries, seek tolerance, evidence replay | `src/components/practice/use-playback-boundary.ts`, `src/lib/section-lookup.ts` |
| Media adapters (YouTube, Vimeo, HTML media, web pages via Hibiki Bridge) | `src/components/media-player.tsx`, `media-youtube.tsx`, `media-vimeo.tsx`, `media-html.tsx`, `media-page.tsx` |
| Hibiki Bridge extension and its app-side protocol | `extension/`, `src/lib/extension/` ([details](browser-extension.md)) |
| Media identity, link resolution, lesson migration | `src/lib/media.ts`, `src/lib/import-lesson.ts` |
| Caption retrieval, ASR detection and labels | `src/lib/providers/youtube-captions.ts`, `src/lib/caption-labels.ts` |
| Whisper subtitles: audio windows, overlap merge, upload | `src/lib/media-audio/`, `src/lib/transcription-client.ts`, `src/lib/providers/ai-transcription.ts` |
| Translation request, cancellation and browser cache | `src/components/practice/use-section-translation.ts`, `src/lib/translation-api.ts` |
| Practice clock and checkpoints | `src/components/use-practice-progress.ts`, `src/lib/practice-clock.ts`, `src/lib/practice-checkpoint.ts` |
| Learner validation, sessions, aggregation, migration | `src/lib/learner/` |
| Browser persistence: lessons (history stores references), preferences | `src/lib/storage/` |
| Authentication (Better Auth on D1) | `src/lib/auth/` |
| Learner sync contract, validation, merge, D1 repository, hydration | `src/lib/sync/` |
| Shared sync engine for review, word states and Watch Later | `src/lib/sync/channel.ts`, `src/lib/sync/channel-status.ts` |
| One word status: saving, Known, grading side effects | `src/lib/vocabulary.ts` ([details](vocabulary.md)) |
| Saved words, context and replay links | `src/lib/dictionary/` |
| Review scheduling, local outbox, D1 review, study limits | `src/lib/review-scheduler.ts`, `src/lib/review/` |
| Word states, incremental sync, lesson vocabulary coverage | `src/lib/knowledge/`, `src/components/use-word-knowledge.ts`, `src/components/lesson-vocabulary.tsx` |
| Lexical assets, lookup and contextual lemma resolution | `scripts/prepare-lexicon.mjs`, `src/lib/lexicon/`, `src/components/lexicon-definitions.tsx` |
| Japanese morphology and Furigana workers | `src/lib/japanese-analysis*.ts`, `src/lib/furigana-*.ts` |
| Discover catalogue, ranking, Watch Later sync | `src/lib/discover/` ([details](discover.md)) |
| Completion recap and revisit evidence | `src/components/lesson-completion-summary.tsx`, `src/lib/lesson-completion.ts` |
| Quiz documents, attempts, prompts and providers | `src/lib/quiz/`, `src/lib/providers/quiz/` |
| Worker runtime: bindings, rate limits, account route wiring | `src/lib/server/runtime.ts`, `src/lib/server/rate-limit.ts`, `src/types/cloudflare-env.d.ts` |
| Worker entry: demo asset, Discover flag, scheduled refresh | `cloudflare-worker.js`, `cloudflare.config.ts` |
| Styles (imported in order; `shell.css` last) | `src/app/globals.css`, `src/app/styles/` |

Import the module you need directly; there are no compatibility facades. Keep server providers out of client components.

## Contracts to preserve

- **API routes** read bindings from `cloudflare:workers` through `src/lib/server/runtime.ts` and must export `dynamic = 'force-dynamic'`; otherwise vinext routes GET responses through its shared response cache.
- **Paid and public endpoints are rate limited** with a constant route name per handler (never the request path). Workers AI routes (transcribe, difficulty, quiz, shadowing) fail closed; caption preparation and translation fail open. Difficulty and quiz wrap their provider with `limitedInference`, so the authored demo and shared-cache hits never spend the budget.
- **Sync is silent.** The only visible sync state is "Your session expired". Channels never sync for signed-out or unverified accounts. Routine triggers (focus, reconnect, a slow poll) reuse a sync from the last five minutes unless local changes are pending.
- **Word-state pulls are incremental** (`synced_at` watermark plus a 60-second overlap). Uploads return the stored value for each lemma so a device that lost last-writer-wins adopts the winner.
- **Media playback**: keep the same mounted media player when display preferences change; recordings, object URLs and the adapter belong to the active practice tree. `section-lookup.ts` reproduces the original boundary predicate, including gaps. Subtitle timing is never stretched.
- **Storage**: keep the `hibiki:v1:` keys. `history` holds `{ lesson: { id }, index, updatedAt }` references (legacy embedded lessons migrate on the next save); section moves write only `position:{id}`. Writes skip unchanged values and notify `hibiki:local-write` once per real change.
- **Transcript identity**: hashes include section IDs, timing and trimmed Japanese; media URLs are excluded.
- **Web-page lessons** (`source: 'page'`) carry a `pageKey`, never a shared `contentKey`, sync with `mediaAvailable: false`, and save words with media type `local`.
- **D1** binds at most 100 parameters per statement; split `IN (…)` lists accordingly.
- **Styles**: later files intentionally override earlier ones. Check intervening declarations before merging duplicate selectors.

## Verification

Use Node 24 (`package.json`) and `npm ci`. On Windows PowerShell, use `npm.cmd` / `npx.cmd` if script policy blocks the shims.

| Change | Checks |
| --- | --- |
| Any code | `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check` |
| Worker, routes, D1 | `npm run build`, then `npm run test:d1:runtime`; `npm run test:d1:migrations` for migrations |
| UI and playback | `npm run build`, `npm run start:test` (port 3001), then `npm run test:e2e` |
| Hibiki Bridge | `tests/extension.test.ts`; `tests/e2e/extension.spec.ts` loads the unpacked extension into Chromium |
| Caption relay | included in `typecheck`; `npm run build:caption-relay` |

Always build with `npm run build`: its prebuild step regenerates the Furigana and media-audio worker bundles in `public/furigana/` that a bare `vite build` leaves stale.

Browser tests read `PLAYWRIGHT_BASE_URL` (default `http://localhost:3001`) and `PLAYWRIGHT_CHROME_PATH`. They use mocked providers and the authored demo; they never contact live AI or caption services. Recording tests need a working fake microphone and `MediaRecorder`; on some Windows setups they fail before recording starts.
