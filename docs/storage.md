# Shared content storage

Cloudflare D1 is Hibiki's primary production application database, including the shared content cache and authenticated accounts/learner state. It uses native `env.HIBIKI_DB`, injected by `cloudflare-worker.js`; request handlers never use D1 REST or database tokens. `cloudflare.config.ts` uses the installed `cf/config` API: `bindings.d1({ name, id })`.

Production database: `hibiki`, ID `cf88fe7d-16bb-4f58-8839-2b27718a7847`, account `faa2e940eaa3b7c4077ed18f34b4e653`, binding `HIBIKI_DB` on Worker `shadowing`.

## Cache hierarchy and trust

Preparation resolves linked identity, reads D1, acquires provider captions on a miss, validates/normalizes/hashes cues, saves them best-effort, then returns segmented practice. Vimeo and direct links have no provider caption acquisition. Whisper subtitles go back to the browser and are never written to the shared cache.

Quiz and difficulty retain browser `loadQuiz`/`saveQuiz` and `loadDifficulty`/`saveDifficulty` as L1. On a browser miss, the API accepts `{ lesson, content?: { contentKey } }`; old bare lesson requests remain supported and bypass shared caching. The server loads and validates a system/shared hosted transcript, resegments it with current rules, and requires its normalized segment SHA-256 fingerprint to equal the request. A client provenance claim, title, video ID or content key alone grants no shared access. Local and user-import browser requests omit `content`.

Eligible requests read D1 L2 before inference. Payloads are parsed and domain-validated against the trusted normalized lesson. Misses invoke the existing provider, validate the output, save eligible artifacts, and return it for browser persistence. Arbitrary client lesson IDs do not create new cache identities: stored payloads use the canonical media lesson ID and are validated/rebound to the caller's lesson ID on return. Models receive exactly the existing compact Japanese inputs, with no storage/user/media metadata.

`X-Hibiki-Cache` is `hit`, `miss` or `bypass` on successful artifact responses. Structured `d1.transcript.hit/miss` and `d1.artifact.hit/miss` logs support controlled smoke checks without logging payloads.

## Schema and identities

`migrations/0001_shared_content.sql` creates:

| Table | Payload | Identity and indexes |
| --- | --- | --- |
| `linked_transcripts` | Validated cues in `cues_json` TEXT; explicit language/source/visibility/version metadata | Primary key `storage_key` = SHA-256(JSON array of contentKey, language, transcriptHash, sourceType, provenance, visibility, generatorVersion-or-empty, schemaVersion, normalizationVersion, segmentationVersion). `linked_transcripts_lookup(content_key, language, created_at DESC, storage_key DESC)` supports latest-revision lookup. |
| `generated_artifacts` | Validated quiz/difficulty in `payload_json` TEXT, source cue hash, payload ID/date | Primary key `id` = SHA-256(JSON array of contentKey, transcriptKey, artifactType, schemaVersion, generatorVersion). UNIQUE on those five columns supports indexed cache lookup. |

`contentKey` is `youtube:<11-character ID>`, `vimeo:<numeric ID>` or `direct:<SHA-256(canonical playback URL)>`. `transcriptHash` covers validated normalized cues; artifact `transcriptKey` is the unchanged SHA-256 of JSON segment tuples `[id,start,end,japanese.trim()]`. Cue and segmented identities serve different purposes. JSON is opaque TEXT; no queries depend on its internal fields. Prepared parameterized queries and uniqueness enforce idempotency. Cache hits never write access timestamps. Identical transcript saves perform no update; invalid artifact payloads can be replaced on validated regeneration.

Generator versions are **`quiz-content-v1`** and **`difficulty-fullcoverage-v1`**, exported from `generated-artifacts.ts`. Bump the relevant version whenever prompts, routing, evidence selection, aggregation or other output-affecting behavior changes. Schema version remains the data contract. Model name alone is insufficient. Old generations remain stored but are not reused after a bump.

## Privacy and failure policy

Hosted anonymous transcript writes permit only `provider-captions` and future `generated` records with explicit generator version, visibility `system`/`shared`, and no owner. Current acquired provider captions use `system`. `user-upload`, `user-paste`, private records, authenticated-owner records and local-file identities are rejected. Anonymous reads enforce the same policy. Generated artifacts are shared only after matching the hosted trust anchor.

The storage-safe media representation contains schema/content identity, media type and optional safe provider/ID. It has no canonical URL, discovered-from URL, Vimeo access hash, signed query, authorization header or playback token. Runtime/browser media configurations retain what playback needs. Database reads validate versions, identity, cue bounds and recomputed hashes. Domain validators remain authoritative for quizzes, coverage and deterministic speech pace. Corrupt/stale rows miss.

D1 lookup/save failures log safe `d1.transcript.lookup_failed`, `d1.transcript.save_failed`, `d1.artifact.lookup_failed` or `d1.artifact.save_failed` events, with artifact type where useful. No exception message, transcript, quiz, URL, relay/DeepL secret or learner history is logged by storage code. Provider acquisition/inference proceeds on failures, and successful results are returned even if persistence fails. D1 is an optimization, not a prerequisite for playback.

Anonymous learner data stays browser-local. Authenticated users additionally synchronize eligible learner state to D1; see [accounts, privacy, tables, merge rules and setup](accounts-and-sync.md). Anonymous keys include: lessons, positions, recent lessons, preferences, reveal state, favorites, translation cache, completion, quiz/difficulty L1, `loadQuizAttempt`/`saveQuizAttempt`, learner history, practice sessions and archives. Existing anonymous localStorage is uploaded only as eligible compact metadata after an explicit first-sign-in import choice. Private transcript/media/translation payloads are never uploaded or invalidated. Browser recordings remain local/in-memory.

## Migration and deployment workflow

Create the database once, apply committed migrations, then deploy the bound Worker. No production reset/destructive migration is part of the workflow. The CLI's migration ledger is `d1_migrations`; files are numbered monotonically and ledger entries prevent reapplication. Check [current D1 migration documentation](https://developers.cloudflare.com/d1/reference/migrations/) and the installed cf command help when changing the workflow.

```sh
npm run db:migrate:local
npm run db:migrations:local
npm test
npm run build
npm run test:d1:runtime

# Production: authenticated cf CLI, same connected account
npm run db:migrate:production
npm run db:migrations:production
npm run deploy   # applies migrations, then deploys the prebuilt Worker
```

`db:migrations:*` lists **pending** migrations; an empty list means current. Applying normally twice is safe. Local migration commands use `.cloudflare/state`, never production. `npm run deploy` gates deployment on a successful production migration.

CI runs `npm run test:d1:migrations` against real persisted local workerd/D1 at `.cloudflare/migration-verification`. It atomically applies each committed migration with its ledger row, verifies the full ledger and an empty `foreign_key_check`, and explicitly disposes Miniflare. This avoids the installed beta `cf` CLI's Linux process-lifetime hang after successful local migration output. The manual local CLI commands and production migration/deployment gate remain unchanged; the populated 0007 → 0008 upgrade is additionally covered by the real D1 integration fixture.

The connected Cloudflare build trigger runs `npm run build`, then `npm run deploy` (`npm run db:migrate:production && cf deploy --prebuilt`). The build token needs D1 migration permissions; a failure stops deployment. Do not assume deployment alone applies SQL. For manual API-based operations, apply the same committed statements and ledger atomically, then verify the ledger before deployment.

`npm test` exercises real local D1/workerd repositories with deterministic fixtures, privacy, corruption, indexed access, uniqueness, forging, version misses and outage fallback. `npm run test:d1:runtime` loads the actual built production Worker with local D1, mocked caption egress and a mocked Workers AI RPC binding. Preparing/quiz/difficulty twice proves each provider is called once; second calls throw if mistakenly invoked. CI does not contact live providers. Production smoke uses real public captions and limited inference, verifies durable row counts and repeated cache headers without dumping content.

## Account data and caches

Accounts and learner tables are described in [accounts and sync](accounts-and-sync.md), and vocabulary storage in [vocabulary](vocabulary.md). Application rows reference the Better Auth user ID; there is no bespoke password system or fake anonymous user. Payment processors stay authoritative for subscriptions; D1 may hold entitlement metadata, never card details.

The browser keeps an account-scoped saved-word cache: at most 700 records and 3 MB of record data, with up to 200 recent review records prioritised. A cached page never stands in for the full remote list, and a full export always reads from the server.

Concurrent cache misses can both run inference before saving; uniqueness prevents duplicate rows. A Durable Object keyed by contentKey + transcriptKey + artifactType could share one inference among waiters if that cost matters.
