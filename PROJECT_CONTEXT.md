# Project Context — Hibiki / Shadowing

> **Purpose:** persistent product and engineering context for future development.
>
> **Current snapshot:** 2026-10-04, production runs on Cloudflare Workers with the caption relay path verified and roadmap priorities #1–#3 implemented. Hosted AI is split by task: Clef Flash provides full-transcript difficulty classification and only assists quiz routing for very large transcripts; ordinary comprehension checks use Qwen3-30B-A3B. On-demand Japanese→English translation uses DeepL with only the current section translated and bounded neighboring Japanese supplied as context. Local learner progress is deployed. The next roadmap item is #4, polish / monetisation.
>
> **Deployment target:** Cloudflare Workers via vinext. Cloudflare is the canonical hosted environment for this project; do not assume Vercel.

## 1. Product purpose

Hibiki is a Japanese listening and speaking practice app built around **shadowing**.

Traditional shadowing asks a learner to listen to native speech and repeat it while the source keeps moving. That is useful, but mechanically difficult: the learner has to keep up, manually seek backwards, remember what was said, and decide when to pause.

Hibiki removes that friction. It turns timestamped Japanese speech into short, natural sections and provides a deliberate practice loop:

**listen → pause → say it back → replay/compare → continue**

The learner should be able to use Japanese content they genuinely want to watch or listen to rather than being restricted to a closed lesson catalogue.

The app should encourage direct comprehension of Japanese. Japanese text remains visible while English translation is hidden until the learner asks for it.

## 2. Product vision

The near-term product is a **shadowing-first player for authentic Japanese media**.

The longer-term vision is:

> **Turn Japanese media into an interactive speaking, comprehension, and review lesson.**

The ideal learning loop becomes:

**Consume → Shadow → Understand → Test → Review → Retain**

Long term, Hibiki should act as a learning layer over Japanese media rather than becoming a generic AI tutor or a generic video transcription product.

The app should eventually understand useful learner signals such as:

- which sections were replayed repeatedly;
- where translations were revealed;
- which words were looked up;
- which comprehension questions were missed;
- which sections were bookmarked or explicitly marked difficult;
- which recordings required repeated attempts;
- which grammar/vocabulary patterns recur in difficult material;
- how difficult different content appears to be for the learner.

Those signals should feed directly back into better practice: weak-section review, useful vocabulary review, adaptive comprehension questions, and eventually pronunciation feedback.

## 3. Product principles

### Shadowing stays central

New features should make authentic-media shadowing more effective. Do not let quizzes, vocabulary tooling, AI chat, gamification, or dashboards displace the primary listen/pause/repeat loop.

### Japanese-first

The architecture may eventually support more languages, but product decisions should optimize for Japanese learners first.

### Authentic content over a closed catalogue

The learner should be able to bring content they already care about. YouTube is the first major source, not the permanent boundary of the product.

### Reveal help when needed

Translation and explanations should be available without becoming the default experience. The learner should first have the chance to understand Japanese directly.

### Context is valuable

Vocabulary, grammar, questions, and review should stay connected to the original media, transcript sentence, timestamp, and speaker audio whenever possible.

### Prefer useful feedback over fake precision

Do not present crude speech-to-text similarity as authoritative pronunciation scoring. A/B listening, recognized-text comparison, and specific qualitative feedback are better than a meaningless score.

### Graceful fallback is part of the product

External services can fail. The app should remain demonstrable and useful through imported subtitles, own media, and the bundled demo rather than becoming unusable when one provider fails.

### Keep infrastructure proportionate

The app began as a personal learning tool. Avoid authentication, complex databases, queues, paid AI dependencies, or large infrastructure until a product requirement justifies them.

## 4. Current implementation

The repository already contains a substantial working MVP rather than scaffolding.

### Home / lesson preparation

The home page currently supports:

- a Japanese video link (YouTube, Vimeo or direct HTTP(S) audio/video);
- a bundled demo lesson;
- importing a supported video link plus a user transcript;
- importing local audio/video plus subtitles;
- recent lessons saved on the current device;
- streamed preparation progress and recoverable error states.

The main YouTube preparation path is:

`src/components/home.tsx`
→ `POST /api/prepare`
→ `youtubeCaptions.transcribe(...)`
→ `segmentTranscript(...)`
→ save lesson in browser storage
→ navigate to `/practice/[id]`.

### Shadowing player

The practice experience already includes:

- Shadowing and Continuous modes;
- automatic pause at segment boundaries;
- replay;
- previous/next;
- click-to-seek transcript rows;
- active transcript following;
- playback speed controls: 0.5×, 0.75×, 1×, 1.25×;
- translation reveal/hide;
- section and lesson progress;
- keyboard shortcuts;
- transcript search;
- bookmarks / saved-section filtering;
- responsive desktop/mobile UI;
- persistence of lesson position and preferences.

### Studio Mode and Furigana

The practice UI offers **Studio Mode**, a locally persisted, reversible layout preference. Desktop uses a wide player, capped relative to viewport height so the current section remains visible on laptops. Existing controls, current-section actions and recording follow immediately; transcript, difficulty and comprehension stay reachable below by scrolling. Tablets/mobile retain a full-width 16:9 player and compact controls. CSS changes the priority of the existing mounted tree: there is no new route, player, or separate playback/quiz state.

**Furigana** defaults off and uses the reusable `JapaneseText` renderer for the current section, full transcript and comprehension questions/options/evidence. Kuromoji 0.1.2 with IPADIC supplies deterministic dictionary readings in a lazy browser worker. There is no AI request or external reading service. The optional dictionary is 17,791,956 compressed bytes; it is justified by inflection and contextual morphology coverage and never enters the main client/Worker bundle. It loads from same-origin static assets only after enabling readings. Canonical Japanese stays untouched; unknown words remain plain. Reading ambiguity and proper names remain limitations.

Both `studioMode` and `furigana` extend the existing `hibiki:v1:preferences` key with strict false defaults for older preferences. Derived annotation promises are cached by canonical source string (bounded to 2,000 entries) and never saved to a Lesson, Segment, D1 or learner history. Future hosted annotation could use `transcriptHash + furiganaGeneratorVersion`; that cache is unimplemented. See [asset preparation, identity verification and browser coverage](docs/studio-furigana.md).

### Post-video comprehension checks

Priority #1 is implemented in the repository. Finishing Shadowing practice or reaching the end in Continuous mode reveals an optional short comprehension check, with Japanese multiple-choice questions, immediate explanations, deterministic scores and replayable transcript evidence. Existing playback remains available on generation failure. Evidence replay uses the same media adapter, spans normalized sections, pauses at the evidence end and returns to the question without losing answers.

`POST /api/quiz` uses a replaceable `QuizGenerationProvider`. Canonical Cloudflare production routes transcripts at a conservative 12,000 non-whitespace Japanese-character ceiling: normal lessons send the complete `{ id, japanese }` transcript directly to `@cf/qwen/qwen3-30b-a3b-fp8`; only larger lessons use `@cf/cloudflare/clef-flash` to score anchors across the full lesson before expanding selected anchors to broader coherent regions for one Qwen generation pass. There is no regeneration loop. No timestamps, media metadata or learner data are sent to either model. Questions/options and exact evidence references/quotes are validated strictly, and application code maps validated segment IDs back to timestamps. Model-returned empty quizzes on otherwise substantial transcripts are treated as malformed generation rather than mislabeled as insufficient content. No quiz API-key secrets are required.

Validated quizzes are reused for a matching lesson/transcript SHA-256 fingerprint. Draft answers, completion and versioned UUID-based attempts persist through the existing local storage helpers. Attempt history includes lesson/video/quiz identity, score, total questions, per-question answers/correctness/evidence and start/update/completion timestamps for future account/profile sync. This adds no accounts or learner-profile system. See [comprehension checks](docs/comprehension-checks.md) for setup, limits and the persistence contract.

### Content difficulty analysis

Priority #2 is implemented as a compact classification rather than a generated explanation panel. The UI shows approximate level (N5+, N5–N4, N4–N3, N3–N2, N2–N1, N1+), vocabulary/grammar/conversation (Beginner → Native), and deterministic speech pace (Slow → Very fast). It is a content estimate, never an official JLPT classification or learner-performance score.

`POST /api/difficulty` uses a replaceable `DifficultyAnalysisProvider`, injected by the canonical Worker through `env.AI`. Production uses `@cf/cloudflare/clef-flash` and sends only normalized Japanese transcript text. Normal lessons use the complete transcript in one decision request. Unusually large scripts are split into consecutive full-coverage chunks and the typed choice probabilities are aggregated deterministically by character weight, avoiding the old 36-section sparse sample. Speech stays deterministic application code and timestamps never go to the model.

Versioned compact records persist through `loadDifficulty`/`saveDifficulty` with the existing SHA-256 transcript fingerprint. The full-coverage strategy version invalidates old sampled caches. The exact demo has an authored classification. Failures, pending inference and blocked storage do not block playback, shadowing, quizzes or completion. The learner profile continues to consume only the compact validated dimensions. See [content difficulty](docs/content-difficulty.md).

### Progress and learner modelling

Priority #3 is implemented locally, without inference. `/progress`, reached through the existing header, derives a versioned learner profile from UUID-based practice sessions, existing quiz attempts, compact validated difficulty references, and current section bookmarks. It shows active practice time, distinct practised/completed lessons, comprehension results and retakes, replay/translation/recording signals, revision-specific lesson history, typical practised content and conservative trends when evidence is sufficient, and transparent attention-section reasons. It links only to locally available matching transcript revisions.

Time uses monotonic intervals: visible advancing playback, recording, 30 seconds after deliberate interaction, or a bounded Shadowing spoken-response window. Hidden/idle/suspended time, quizzes and difficulty waits are excluded. Sessions resume in the same tab within 30 minutes for the same transcript; later practice creates a new UUID. Checkpoints, lifecycle flushes and idempotent legacy backfill preserve known facts without inventing historical time or reveal counts. Detailed sessions compact into bounded per-revision archives while retaining lifetime totals and section signals; storage failures warn without blocking playback. See [learner progress](docs/learner-progress.md) for exact algorithms, contracts, bounds, migration and limitations.

Verification: 75 unit tests and all 24 Playwright tests pass on both the Next.js production server and built Cloudflare preview using installed Chrome; lint, typecheck and both builds pass. This implementation adds no accounts, hosted sync, analytics, recommendations, adaptive practice, vocabulary saving or automatic weak-section review. The next priority is #4; it is not implemented here.

### Voice recording

Basic learner recording is already implemented with browser `MediaRecorder`:

- record the learner's attempt;
- replay it;
- switch back to source audio for A/B comparison;
- recordings remain local/in-memory and are not uploaded;
- microphone denial degrades gracefully.

This means future pronunciation work should build on the existing recording flow rather than replacing it.

### Media playback

`src/components/media-player.tsx` dispatches isolated adapters through normalized `MediaHandle` controls:

1. **YouTube:** official IFrame Player API, using `youtube-nocookie.com`, an explicit `origin`, playback controls, retries, and player error handling.
2. **Vimeo:** documented browser Player SDK, serialized commands and actual-time polling; embedding/privacy and speed changes remain subject to creator settings.
3. **Direct/local/demo media:** browser `<video>` playback, with codec/decode and finite-duration errors. Unsupported public pages get a bounded, credential-free browser CORS discovery attempt for HTML media sources/OpenGraph/JSON-LD; an extracted direct media link is exposed. Generic iframe embedding alone is unsupported.

YouTube timing is inherently less precise than direct HTML media. The player currently checks shadowing boundaries frequently and pauses hidden-tab shadowing to reduce timer-throttling overshoot.

### Transcript acquisition

Current transcript sources are:

- YouTube Japanese captions through an authenticated relay/direct provider chain; both use `youtube-transcript-plus` behind a fetch/response-validation adapter;
- imported SRT;
- imported WebVTT;
- imported JSON;
- imported ASS/SSA Events Dialogue lines;
- timestamped TXT (untimed text is rejected);
- pasted timestamped transcript text;
- optional local Whisper/faster-whisper for the learner's own media.

All imported formats share cue validation. Genuine missing Japanese captions retain the resolved video and open **Video link + transcript** automatically; caption infrastructure failures stay errors. Vimeo/direct links enter the transcript continuation immediately. Local file selection is capability-based, retains the 250 MB bound, and reports browser decode failures.

### Segmentation

`src/lib/segmentation.ts` normalizes and segments timestamped cues into useful shadowing sections. It handles punctuation, pauses, rolling captions, overlaps, validation, and proportional timing estimates when a cue is split.

Typical target length is roughly 2–8 seconds, but natural language boundaries take priority.

### Translation

English is lazy and hidden by default.

Canonical production translation uses the DeepL text-translation API with a server-only `DEEPL_AUTH_KEY`. When the learner explicitly reveals a translation, the current Japanese section is sent as the text to translate and at most one neighboring Japanese section on each side is supplied through DeepL's context field. Context is not returned as translated text and is not counted toward billed translation characters. API Free keys (suffix `:fx`) use `https://api-free.deepl.com`; other keys use `https://api.deepl.com`. Results are cached in the browser and in a bounded server-memory cache. Imported/authored translations bypass the API. MyMemory remains a keyless local/non-Cloudflare fallback only. Translation failure is retryable and never blocks shadowing.

### Persistence

Native Cloudflare D1 stores reusable provider Japanese captions and validated quizzes/difficulty artifacts derived from matching hosted system transcripts. Cache reads verify cue and segmented transcript hashes; generator versions invalidate output changes. D1 failures fall back to caption acquisition/inference. Private uploads and playback secrets never enter the shared store. See [storage architecture and migrations](docs/storage.md).

Current learner progress remains browser-local:

- lesson data;
- recent history;
- last section;
- mode;
- playback speed;
- translation visibility;
- bookmarks;
- translation cache;
- transcript-specific lesson completion, cached comprehension checks and resumable quiz-attempt history;
- versioned local learner-history sessions and compact retention archives, independent of the eight recent lessons;
- deterministic learner-profile aggregation and validated compact content-difficulty references.

There is no account system, hosted user database, or cross-device sync.

### Demo

A bundled original Japanese demo is available independently of external services. It includes synthetic Japanese speech, authored translations, media, and timestamps.

This is important and should remain: the product must always have a deterministic way to demonstrate the core shadowing UX.

### Testing

The repository includes:

- unit tests for segmentation/subtitle behavior;
- Playwright end-to-end tests for the core demo flow;
- microphone success/denial coverage;
- local media/subtitle import coverage;
- mobile/layout checks;
- deterministic comprehension schema/scoring/evidence/persistence/provider tests and Playwright quiz/replay/recovery/mobile coverage, including the built Cloudflare preview;
- deterministic content difficulty schema, pace, sampling, fingerprint/storage and mocked Workers AI tests, plus browser summary/details/cache/retry/mobile/transcript-edit coverage;
- integration-check tooling for real caption/translation services.

`scripts/check-integrations.mjs [base-url]` can exercise `/api/prepare` and `/api/translate` against either localhost or a hosted deployment.

## 5. Current technical architecture

Current stack:

- Next.js 16 App Router;
- React 19;
- TypeScript;
- authored CSS;
- Lucide icons;
- Cloudflare Workers deployment via vinext/Vite;
- Workers Cache adapter for page responses;
- native Cloudflare D1 for shared linked transcripts and trusted quiz/difficulty artifacts;
- browser `localStorage` for anonymous learner/practice persistence.

Important files:

| Location | Responsibility |
| --- | --- |
| `src/components/home.tsx` | URL preparation, progress, demo, recent lessons |
| `src/components/practice.tsx` | practice state, segment navigation, boundaries, transcript, bookmarks, translation |
| `src/components/media-player.tsx` | YouTube, Vimeo and HTML-media adapter dispatcher |
| `src/components/voice-recorder.tsx` | MediaRecorder flow and A/B listening |
| `src/components/import-dialog.tsx` | Video link + transcript and own-media import |
| `src/lib/types.ts` | Lesson/segment/provider contracts |
| `src/lib/segmentation.ts` | transcript cleanup and shadowing segmentation |
| `src/lib/subtitles.ts` | SRT/VTT/ASS/SSA/JSON/timed TXT parsing |
| `src/lib/providers/transcription.ts` | YouTube provider chain and imported transcript provider |
| `src/lib/providers/youtube-captions.ts` | Direct/relay retrieval, response checks and infrastructure fallback |
| `src/lib/providers/errors.ts` | Safe diagnostic logging and error normalization |
| `scripts/caption-relay.ts` | Outbound Node caption host |
| `tools/caption-relay-worker/` | Authenticated broker Worker and hibernating WebSocket Durable Object |
| `src/lib/providers/translation.ts` | translation provider |
| `src/lib/storage.ts` | local persistence |
| `src/lib/learner-types.ts`, `src/lib/learner-progress.ts` | versioned learner contracts, validation and deterministic profile/content/attention aggregation |
| `src/lib/learner-storage.ts` | learner-history persistence, portable quiz-history reads and idempotent legacy migration |
| `src/lib/practice-clock.ts`, `src/lib/practice-checkpoint.ts` | monotonic active time, actual playback activity and bounded incremental checkpoints |
| `src/components/use-practice-progress.ts` | practice signals, session resume and lifecycle persistence |
| `src/components/learner-progress.tsx`, `src/app/progress/page.tsx` | dedicated local learner-progress surface |
| `src/lib/quiz.ts` | quiz validation, evidence mapping, transcript fingerprint, scoring and attempt contracts |
| `src/lib/difficulty.ts` | content difficulty validation, deterministic speech metrics and full-transcript input |
| `src/lib/providers/difficulty.ts` | Clef Flash full-coverage typed classification and authored demo estimate |
| `src/lib/difficulty-api.ts`, `src/app/api/difficulty/route.ts` | bounded, independent difficulty API shared with the canonical Worker |
| `src/components/lesson-difficulty.tsx` | lazy compact difficulty classifications and retry |
| `src/lib/providers/quiz.ts` | direct full-transcript Qwen routing for normal lessons, Clef-assisted selection for very large lessons, and authored demo quiz |
| `src/components/comprehension-quiz.tsx` | optional lesson quiz, feedback, replay and results |
| `src/app/api/quiz/route.ts` | bounded, recoverable quiz-generation route |
| `src/app/api/prepare/route.ts` | streamed YouTube preparation route |
| `src/lib/translation-api.ts`, `src/app/api/translate/route.ts` | shared lazy translation handler; Workers AI in production |
| `cloudflare.config.ts` | Cloudflare Worker definition |
| `vite.config.ts` | vinext + Cloudflare build integration |
| `scripts/check-integrations.mjs` | real hosted/local integration smoke check |

## 6. Hosting: Cloudflare is canonical

The hosted app uses **Cloudflare Workers**, not Vercel.

Current deployment path:

- `npm run build:vinext`
- `npm run db:migrate:production` (must succeed before Worker deployment)
- `npx cf deploy --prebuilt`

The app is packaged as one Worker. Automatic captions use a small authenticated broker Worker and a SQLite Durable Object with a hibernating WebSocket to an outbound Node relay host, with direct retrieval retained as a fallback. No R2 bucket, hosted user database, paid caption API or separate cache Worker is required. Treat this caption path as implemented infrastructure unless a production regression is observed; operational details live in [production caption operations](docs/production-captions.md).

The app enables `nodejs_compat` and `global_fetch_strictly_public`; the latter makes public HTTPS broker requests reach the other Worker.

When diagnosing a bug that occurs only after deployment, reproduce it in the actual Cloudflare Workers runtime rather than assuming behavior from `next dev` or a conventional Node server is representative.

---

# 7. Production caption path — implemented and verified

The production YouTube → lesson path is working end-to-end. Treat the caption subsystem as implemented infrastructure unless a reproducible production regression appears.

Current flow:

`/api/prepare` → configured caption relay → authenticated broker Worker → Durable Object/WebSocket bridge → outbound Node caption host → normalized cues → segmentation → NDJSON lesson → browser storage → `/practice/[id]`.

The app keeps direct caption retrieval as a fallback and records the actual provider in `transcriptSource`. Unavailable/private videos remain content errors. Genuinely missing Japanese captions open the retained-video user-transcript continuation. Relay/network/provider failures stay distinct errors; none justify redesigning the working relay path.

Server-only settings are `YOUTUBE_CAPTION_RELAY_URL` and `YOUTUBE_CAPTION_RELAY_TOKEN`. Keep secrets out of browser variables. Structured logs already cover provider selection, upstream status, preparation stages, timings, failures and completion.

Production verification has exercised real Japanese-caption videos through the deployed Worker and browser flow. Do not spend roadmap time re-investigating caption egress unless monitoring or a reproducible user report shows a new regression. Use [production caption operations](docs/production-captions.md) for deployment, health checks and troubleshooting.

DeepL translation is independent from caption preparation. Translation failure must not block shadowing.

---

# 8. Media and transcript contracts — implemented

The model now separates versioned `MediaSource` (YouTube/Vimeo/direct/local/demo) and `TranscriptSource` (provider-captions/user-upload/user-paste/generated/authored) from normalized lesson sections and playback controls. Linked sources have deterministic `contentKey` values; local files never have globally reusable identity. Normalized-cue SHA-256 transcript hashes remain independent from media identity and existing quiz/difficulty fingerprints.

Legacy lessons migrate additively on read/save, retaining IDs, sections and learning artifacts. The existing `source`, YouTube-only `videoId` and readable `transcriptSource` label remain compatible; new `mediaSource` and `transcript` contracts carry the normalized identity and provenance.

A production native D1 `LinkedTranscriptRepository` with a no-op Next development fallback and future `GeneratedTranscriptProvider` contract establish the sequence: resolve identity → transcript lookup → provider captions → user transcript now → future approved-audio generation → validate → persist/reuse with explicit visibility. D1 now stores eligible system/provider transcripts and validated quizzes/difficulty derived from matching trusted hosted transcripts. Hosted AI subtitle generation and remote media download remain unimplemented. See [storage](docs/storage.md). User transcripts remain private/browser-local.

See [media sources](docs/media-sources.md) for exact contracts, migrations, extraction security/limitations, supported URLs/formats and deterministic tests. Practice continues to consume normalized `MediaHandle` operations; provider-specific code stays in adapters. The current user-requested source expansion does not reorder the remaining roadmap below.

Verification for this refactor: 94 unit tests and all 35 Playwright tests pass on the Next.js production server and built Cloudflare Worker in local workerd. Type checking, lint and both builds pass; lint retains four pre-existing unused-code warnings. The isolated Worker test configuration omits remote inference/production secrets; provider/player boundaries are mocked. Two stale difficulty-panel tests were updated to match the already-implemented compact classification UI without changing that feature.

---

# 9. Product roadmap — ordered priorities

Feature work should follow this order unless a concrete production regression or prerequisite forces a change. Do not move file-upload/content-source expansion ahead of the learning features above it.

## 1. Post-video comprehension tests

**Implemented:** optional completed-lesson checks, strict output/evidence validation, deterministic scoring, bounded evidence replay, transcript-keyed local reuse and portable attempt history. Canonical production generation uses native Workers AI; the demo is independent of inference. Later quality tuning is separate from roadmap #2.

After a learner completes a video, generate a short multiple-choice comprehension test grounded only in the transcript.

Requirements:
- several question types such as main idea, detail, sequence, vocabulary/grammar in context, reference resolution and reasonable inference;
- deterministic scoring;
- a concise explanation after each answer;
- transcript evidence timestamps for every question;
- a **Replay relevant section** action that seeks directly to the supporting moment;
- quiz generation failure must never block the completed shadowing lesson;
- keep model/provider code behind a replaceable question-generation interface.

Persist quiz attempts as learner signals for the profile described below.

## 2. Content difficulty analysis

**Implemented:** hybrid deterministic speech pace and lazy semantic JLPT/vocabulary/grammar/conversation estimates, strict evidence validation, bounded full-lesson sampling and transcript-keyed local persistence. Production Qwen smoke testing has occurred. The priority #3 learner profile now reuses this content identity and compact dimensions.

Analyze each completed/prepared lesson and estimate:
- approximate JLPT range;
- vocabulary difficulty;
- grammar difficulty;
- speech speed;
- conversational complexity.

Store both a compact overall level and the underlying dimensions. Treat the result as an estimate, not an official JLPT classification. Prefer explainable signals that can later feed learner-specific difficulty.

## 3. Progress and learner modelling

**Implemented in the repository and verified on both production runtimes locally:** versioned local practice sessions, conservative active-time tracking, replay/reveal/bookmark/recording metadata, existing quiz-history aggregation, exact-transcript content-difficulty association, median typical-content/trend estimates, transparent section attention, migration, bounded retention and `/progress`. No formal learner JLPT level is inferred. No hosted sync or later roadmap item is included. Next priority: #4, polish / monetisation. See [learner progress](docs/learner-progress.md).

Build a persistent **user/learner profile**, not merely aggregate counters.

The profile should accumulate a history of lessons and outcomes, including where available:
- video/lesson watched;
- date and completion state;
- estimated content difficulty/JLPT range;
- time spent shadowing;
- replay frequency;
- quiz attempted/not attempted and score;
- translation reveals;
- bookmarked/saved sections (saved vocabulary remains priority #10);
- difficult or repeatedly replayed sections;
- learner's typical content level and recent trend.

The first version may remain local-first, but choose data contracts that can later sync to an account without redesigning the feature model. The profile should become the shared input for adaptive difficulty, weak-section review, recommendations and future cross-device sync.

## 4. Polish / monetisation layer

Only after retention signals justify it, add:
- accounts;
- cross-device sync;
- durable hosted persistence;
- analytics;
- sensible free/premium limits;
- premium features;
- subscription/billing infrastructure.

Do not let monetisation architecture dominate the current learning-product work.

## 5. Broaden content sources

After the higher-priority learning loop exists, improve source flexibility:
- ASS/SSA subtitle parsing (implemented);
- global subtitle offset controls;
- bilingual subtitle alignment;
- browser-playable direct media URLs and controlled Vimeo embeds (implemented);
- versioned separation of `MediaSource` and `TranscriptSource` (implemented; D1 shared content caching exists, future subtitle generation remains a contract only).

Local media remains a first-class privacy/cost-friendly path. Do not promise arbitrary streaming-site support.

## 6. Transcript intelligence — end-of-video review

Do **not** make tap-to-lookup the main feature.

At the end of a lesson, generate a concise review containing:
- important grammar actually used in the video, constrained to roughly the video's/learner's level;
- a key vocabulary/expressions list from the transcript;
- source sentence and timestamp/context for each item where practical.

Avoid surfacing advanced grammar merely because it can technically be detected. For example, an N3-level lesson should not turn into an N1 grammar lesson.

## 7. Weak-section review

Use learner signals such as replay count, repeated attempts, translation reveals, quiz evidence and explicit bookmarks to identify difficult moments.

Automatically create a shorter review/shadowing session from those sections, preserving timestamps and enough surrounding context to make each clip understandable.

## 8. Personalised difficulty / adaptive practice

Estimate how difficult a lesson and individual sections are **for this learner**, using the learner profile plus content analysis.

Use that estimate to adapt:
- quiz difficulty;
- review selection;
- amount/type of assistance;
- recommended next content range.

Keep the adaptation explainable and avoid hiding the original transcript/content.

## 9. Pronunciation feedback

Build incrementally:
1. speech-to-text comparison against the target line;
2. timing/alignment feedback;
3. mora and vowel-length issues;
4. rhythm;
5. potentially pitch-accent feedback when reliability is good enough.

Reuse the existing browser recording flow. Do not present low-confidence pronunciation analysis as authoritative.

## 10. Saved vocabulary and contextual review

Let learners save words/expressions with:
- source sentence;
- video/lesson;
- timestamp;
- meaning/translation;
- replayable source audio/context.

Later add spaced repetition. Keep saved items tied to authentic context rather than becoming a detached generic word list.

## 11. AI conversation based on the video — low priority

After the core comprehension/review/adaptive loop is strong, optionally let learners discuss the completed content in Japanese.

Ground the conversation in:
- the transcript;
- lesson summary;
- important vocabulary/grammar;
- learner level/profile.

This should feel like active production connected to the video, not a generic chatbot. It is intentionally the lowest priority in this roadmap.

---

# 10. Features already implemented — do not re-plan them as future work

Future agents should verify before proposing work. At this snapshot, the following already exist:

- Shadowing vs Continuous playback;
- automatic segment pause;
- replay/previous/next;
- playback speed;
- lazy translation;
- browser voice recording;
- A/B playback;
- transcript search;
- bookmarks/saved-section filtering;
- recent local lessons;
- local progress persistence;
- post-video comprehension checks with explanations, evidence replay, quiz reuse and local attempt persistence (native Workers AI in canonical production);
- content difficulty estimates with deterministic caption pace, bounded semantic analysis, validated evidence and local reuse (production Qwen smoke-tested);
- local persistent learner profile with practice sessions, active time, section signals, comprehension history, typical practised content, conservative trend and dedicated progress page (locally verified; this feature's deployment pending);
- local own-media import;
- SRT/VTT/ASS/SSA/JSON/timestamped TXT transcript import;
- YouTube/Vimeo/direct linked media + user transcript import and retained-link no-caption continuation;
- best-effort browser-side public media discovery;
- bundled deterministic demo;
- optional local Whisper;
- responsive/mobile behavior;
- keyboard shortcuts;
- unit and Playwright tests;
- Cloudflare Workers/vinext deployment configuration.

---

# 11. Known constraints / technical debt

### Translation service is best-effort

Canonical production translation depends on DeepL and can still fail, time out, hit rate limits, or exhaust account quota; failures remain retryable and must never block shadowing. MyMemory is retained only as the keyless local/non-Cloudflare fallback and may have quota/quality limits.

### No hosted user progress

Progress is local to the current browser/origin. This is intentional for now, but later personalization across devices will require accounts/storage.

### Comprehension generation needs server configuration

The bundled demo is independent of inference. Canonical Cloudflare production uses the native `AI` binding; standard Next.js development may use the existing optional chat-completions adapter. API input remains bounded at 2,000 normalized sections / 60,000 Japanese characters. Qwen has a 32,768-token context window, so the production router deliberately uses a much lower 12,000-character direct-input ceiling and introduces Clef-assisted selection above that point rather than approaching the hard context limit. Structural/evidence checks cannot prove the semantic correctness of every model-generated question. Quiz results remain local and do not yet sync to an account.

### Content difficulty is an estimate

Bounded samples can miss unusual sections and distant references. Caption-derived speech pace depends on spelling and timing, not measured morae or audio activity; its thresholds are product heuristics. Semantic quality needs real-lesson evaluation. Native inference already underway may continue after the request timeout. Estimates have browser L1 caching and D1 L2 reuse for trusted hosted transcripts; learner data remains local without cross-device sync. See [content difficulty limitations](docs/content-difficulty.md).

### Translation server cache is in-memory

The Worker-side Map is not a durable shared cache. Browser caching is currently more important.

### Local uploaded media is session-bound

Object URLs cannot survive a full refresh. The transcript persists but the learner must reattach the original file.

### Optional Whisper is local-only

The Python faster-whisper service is not part of the hosted Cloudflare app.

### Media/transcript model needs generalization

Before many new providers are added, separate media source from transcript source as described above.

---

# 12. Development priorities

Use the exact roadmap ordering in section 9 when tradeoffs are necessary:

1. Post-video comprehension tests
2. Content difficulty analysis
3. Progress and learner modelling, centered on a persistent learner profile
4. Polish / monetisation layer
5. Broaden content sources
6. End-of-video transcript intelligence: level-appropriate grammar + key vocabulary
7. Weak-section review
8. Personalised difficulty / adaptive practice
9. Pronunciation feedback
10. Saved vocabulary and contextual review
11. AI conversation based on the video — deliberately low priority

Core playback, preparation and segmentation reliability remain regression constraints, but they are not roadmap items to re-investigate without evidence of a real regression.

---

# 13. Definition of product success

A strong version of Hibiki should make this experience feel effortless:

1. choose Japanese content the learner genuinely wants to consume;
2. turn it into timestamped practice quickly;
3. listen to a natural section;
4. pause automatically;
5. repeat it without fighting the player;
6. compare/replay when needed;
7. reveal help only when necessary;
8. finish the content;
9. test actual understanding;
10. revisit the exact weak moments;
11. retain useful vocabulary/grammar in context;
12. see the next practice session become more personalized.

The long-term moat is not “AI features.” It is the combination of authentic media, timestamped context, frictionless shadowing, learner signals, and targeted review.
