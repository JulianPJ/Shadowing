# D1 persistence verification — 2026-10-04

Production setup and rollout completed using the connected Cloudflare account. No account-level approval or missing permissions required user intervention.

## Production resources and migration

| Item | Verified value |
| --- | --- |
| Database | `hibiki` |
| Database ID | `cf88fe7d-16bb-4f58-8839-2b27718a7847` |
| Worker/binding | `shadowing` / `HIBIKI_DB` |
| Committed migration | `migrations/0001_shared_content.sql` (implementation commit `816674a`) |
| Migration ledger | `d1_migrations` contains `0001_shared_content.sql`; pending list empty |
| Deployment | Worker version `bf7d1480-f3ca-4176-b885-df2f18845968` |
| Origin | <https://shadowing.julianpopovskijones.workers.dev> |

The database was created first, the committed migration applied next, and the Worker deployed afterward. Connected-account inspection confirmed the D1 binding and preservation of AI, ASSETS, IMAGES, version metadata, DeepL and caption-relay secrets. Local migration applied from empty storage; its second normal application performed no work.

The Cloudflare build trigger's deployment command is now `npm run db:migrate:production && npx @vinext/cloudflare deploy --prebuilt`. The installed CLI supports `--prebuilt` rather than the previous `--skip-build`. Migration failure prevents deployment. No manual database creation, migration, binding or deployment remains for this rollout.

## Schema, keys and privacy

`linked_transcripts` stores safe linked identity, language, cue hash, source/provenance, visibility, normalization/segmentation versions, JSON cues, optional generator/model/owner metadata and creation time. The deterministic `storage_key` primary key identifies revisions; `linked_transcripts_lookup(content_key, language, created_at DESC, storage_key DESC)` supports the actual lookup.

`generated_artifacts` stores content/segmented-transcript identity, source cue hash, artifact/schema/generator versions, payload ID, validated JSON and creation time. Its primary key is SHA-256 of `[contentKey, transcriptKey, artifactType, schemaVersion, generatorVersion]`; UNIQUE on those same columns prevents duplicate logical records and serves indexed lookup. Transcript storage-key inputs are `[contentKey, language, transcriptHash, sourceType, provenance, visibility, generatorVersion-or-empty, 1, 1, 1]`.

Generator versions: `quiz-content-v1` and `difficulty-fullcoverage-v1`. Bump output-affecting generation changes independently of schema versions.

Anonymous writes/reads allow system/shared `provider-captions` and future versioned `generated` transcripts without an owner; acquired captions currently use `system`. User-upload, user-paste, private/owned transcripts and local media are excluded. Stored media identity has no playback URL, direct signed query, discovered-from URL or Vimeo access hash. Server-side validation, resegmentation and exact transcript-key matching prevent arbitrary browser transcripts from populating or consuming another content key's artifact cache. Provenance declarations alone confer no trust.

Browser helpers remain intact: `loadQuiz`, `saveQuiz`, `loadDifficulty`, `saveDifficulty`, `loadQuizAttempt`, `saveQuizAttempt`, lesson/history/position/preferences/favorites/translation/completion helpers, and all learner-history/practice-session/archive persistence. No localStorage migration to hosted data, account system, billing, vocabulary saving, learner sync or AI subtitle generation was added.

## Deterministic verification

| Check | Result |
| --- | --- |
| Unit/regression tests | 111 passed, including 17 new local D1/workerd tests |
| Transcript tests | First miss/provider/save, second hit/provider bypass; corrupt JSON/hash/version/visibility rejection; private/import/owner rejection; signed direct/Vimeo URL exclusion; idempotency; indexed query; lookup/save fallback |
| Quiz and difficulty tests | Each: miss/save/hit, throwing provider bypass, generator/transcript invalidation, corrupt payload misses, forged identity rejection, local/private bypass, lookup/save fallback, uniqueness/index use and safe lesson-ID rebinding |
| Built Worker integration | Actual production bundle + local D1 + mocked caption egress/AI RPC: preparation, quiz and difficulty each called provider exactly once across two requests |
| Playwright on Next production | 35 passed |
| Playwright on built local Worker + D1 | 35 passed |
| Lint | Passed; four pre-existing unused-code warnings, zero errors |
| Typecheck | Passed, including caption-relay Worker types |
| Next build | Passed |
| vinext/Cloudflare build | Passed; existing dependency-import/route-classification notices |
| Browser checks | Home renders on both local runtimes and live production; no browser errors |

Deterministic CI uses no live YouTube, DeepL or Workers AI. The built integration mock throws on an accidental second caption/quiz/difficulty provider call.

## Live production cache paths

Controlled real smoke used public Japanese-caption video `IJ6R4u05ppw` (252 normalized sections), with no transcript/quiz payloads printed. Production Workers observability confirmed the following storage events on the deployed version:

| Path | First request | Second request |
| --- | --- | --- |
| `/api/prepare` | `d1.transcript.miss`; HTTP 200; 1,645 ms | `d1.transcript.hit`; HTTP 200; 227 ms |
| `/api/quiz` | `d1.artifact.miss`; header `miss`; HTTP 200; 14,392 ms | `d1.artifact.hit`; header `hit`; HTTP 200; 167 ms |
| `/api/difficulty` | `d1.artifact.miss`; header `miss`; HTTP 200; 820 ms | `d1.artifact.hit`; header `hit`; HTTP 200; 253 ms |

Repeated artifact responses matched exactly, including artifact IDs and generation dates. Production D1 held one system/provider transcript and one artifact of each type for that content key; neither duplicate rows nor private records were created. DeepL translation returned HTTP 200 with provider `DeepL`. The live home rendered without browser errors. Raw local evidence and screenshots are in ignored `artifacts/d1-*` files.

Remaining limitation: concurrent first misses can each infer before saving; uniqueness prevents duplicate records. Future Durable Object single-flight coordination is documented but unimplemented. Hosted learner/account persistence remains future work. The implementation branch is reviewable separately from the completed production rollout.
