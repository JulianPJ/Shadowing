# Content difficulty analysis

Priority #2 is implemented. This is a content-only estimate, independent of quiz scores, learner behaviour or a profile. It adds no accounts, adaptive practice, grammar/vocabulary review, media sources or monetisation.

## Flow and placement

The lesson information card sits below the practice/recording/completion area. It immediately shows deterministic speech pace. **Estimate difficulty** explicitly requests the semantic estimate; preparing a lesson, finishing it, opening practice or refreshing does not trigger inference. A cached result shows a compact five-dimension summary and expandable explanations with representative quotes and section times. Playback and comprehension remain usable during requests and after failures.

The browser posts the normalized Japanese transcript to `POST /api/difficulty`. The canonical Cloudflare entrypoint injects `createWorkersAiDifficultyProvider(env.AI)` into the shared request handler. The adapter implements `DifficultyAnalysisProvider.analyze(input, signal)` and sends only bounded samples to inference. There is no external provider, API-key secret or browser credential. The standard Next.js handler serves the authored demo and recoverable unavailable states for other lessons; use the Workers environment for native inference.

`@cf/zai-org/glm-4.7-flash` is reused from the existing server-side model configuration. Its multilingual capability, documented JSON mode and context capacity are sufficient for this bounded classification request, without a provider/model migration. [Cloudflare model reference](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/). Requests use JSON object mode, 2,200 completion tokens, temperature 0.1, thinking disabled and `rejectIfBusy: true`. There is one inference per requested uncached result, no automatic retry or aggregation inference. The route stops waiting at 30 seconds (browser: 35 seconds). Native binding inference does not support an AbortSignal, so timeout/cancellation stops waiting and ignores late results; it cannot guarantee stopping billed work already underway.

The exact canonical demo uses a checked-in authored estimate rather than inference, mirroring the authored comprehension check. Changing its identity/transcript removes that exception. Deterministic tests never call a live model. Semantic quality on real lessons still needs explicit evaluation; structural validation does not establish that an interpretation is correct.

## Deterministic speech pace

This measures **caption pace at original playback speed**, not mora rate, perceived learner difficulty or audio-level voice activity.

1. Normalize text with NFKC. Count Unicode code points in Han, Hiragana or Katakana scripts, plus `ー`. Exclude punctuation, spaces, Latin letters and digits. Kanji counts as one character regardless of its reading.
2. Use Japanese-bearing normalized sections. Sum their `end - start` intervals. Add an intervening gap only if it is **at most one second**. Exclude longer gaps completely, along with leading/trailing silence and sections with no Japanese-script characters. Invalid intervals are ignored defensively; the API rejects malformed/overlapping transcripts.
3. Calculate `60 × Japanese characters / active seconds`, rounded to one decimal internally. Durations stored for inspection are also rounded to one decimal. The UI displays a qualitative label and, in details, an approximate whole-number rate.
4. Require at least **40 Japanese characters, two Japanese-bearing sections and 10 active seconds**. Otherwise rate/level are null and the label is “Not enough timing data.”

| Japanese characters/min | Label | Internal level |
| --- | --- | --- |
| below 180 | Slow | 1 |
| 180 to below 260 | Moderate | 2 |
| 260 to below 340 | Natural conversational | 3 |
| 340 to below 420 | Fast | 4 |
| 420 and above | Very fast | 5 |

These thresholds are product heuristics, not validated linguistic or JLPT boundaries. Captioned intervals can contain pauses; long pauses inside a section cannot be removed without audio analysis. Caption recognition, segmentation timing, kanji/kana spelling and speaker overlap can affect the rate. Playback speed changes do not change content difficulty.

## Semantic analysis and bounded coverage

The model estimates the **dominant** JLPT range (N5 easiest through N1 hardest), vocabulary difficulty, grammar difficulty and conversational complexity. It considers lexical frequency, abstraction, idioms, colloquial constructions, clause nesting, omissions, implied references and discourse demands. The prompt explicitly prevents one exceptional word/sentence from promoting an entire lesson. Vocabulary/grammar use a 1–5 basic-to-very-advanced scale; conversation uses a separate 1–5 low-to-very-high complexity scale. Human-readable labels are derived in application code. Scores exist internally and are not presented as precise ability measurements.

Sampling version 1 takes up to **12 equally spaced windows**, each with up to **three neighboring sections**, spanning the first and last sections and the middle. Overlapping selections are deduplicated. Every selected section is capped at **250 Unicode code points**, producing at most **36 excerpts / 9,000 code points**. Short transcripts use all sections when they fit. Window separation is explicit in the prompt; the model must not invent discourse connections across gaps. There is no “first few minutes only” fallback. Evidence must occur in the actual excerpt sent to the model as well as in the normalized original.

Repository examples inspected before implementation: the demo has 14 sections / 276 text characters / 75.6 seconds; saved real-caption lessons have 252 sections / 8,710 characters / 24.3 minutes and 362 sections / 14,058 characters / 36.8 minutes. Sampling avoids injecting whole long lessons and keeps Free-tier usage proportionate. Coverage counts are persisted and displayed. Sampling caps high confidence at medium; fewer than 200 Japanese characters or under 2% text coverage forces low confidence. Samples may miss unusual sections, humour or distant references. Long individual sections contribute bounded prefixes, which can lose later clauses.

Input bounds: 10,000 normalized sections, 300,000 UTF-16 text characters, 5,000 characters per section, timestamps up to 24 hours, and a 1,600,000-byte request body. The original quiz limits remain unchanged (2,000 sections / 60,000 characters). Semantics require at least two sections / 40 Japanese-script characters. Unsupported input returns a safe recoverable response and never changes the lesson.

## Strict validation and persistence

Every model object rejects missing and unexpected fields. JLPT endpoints must be known and ordered from easier to harder. Scores must be integers 1–5; confidence must be low/medium/high. Explanations must be nonempty and at most 450 characters. Each semantic dimension requires 1–3 examples: a known sampled segment ID, exact contiguous Japanese quote of at most 180 characters and justification of at most 240 characters. Duplicate normalized quotes within a dimension, fabricated quotes, unsampled references and model-supplied timestamps are rejected. Start/end times come from normalized sections and refer to the whole supporting section, not word alignment. Malformed JSON, incomplete completions and oversized model content are rejected.

`ContentDifficultyAnalysis` in `src/lib/types.ts` is versioned (`schemaVersion: 1`) and contains:

- deterministic identity `difficulty:v1:{lessonId}:{transcriptKey}`, lesson ID, SHA-256 normalized transcript key and generation timestamp;
- approximate JLPT range, derived label, concise explanation and capped confidence;
- vocabulary, grammar and conversational dimensions with compact evidence;
- deterministic speech metrics (`metricVersion: 1`) and sampling coverage (`strategyVersion: 1`).

The existing quiz `transcriptKey`/`transcriptRevision` and normalization are reused. Text, section IDs or timings change the key; translations, media URLs and learner performance do not. Whitespace around segment text is normalized consistently. The stable analysis ID and transcript key can be referenced from a future lesson-history/profile event without implementing that profile.

`loadDifficulty` and `saveDifficulty` extend existing safe storage helpers. One compact current record per lesson is stored at `hibiki:v1:difficulty:{lessonId}`. No full transcript is duplicated. Reload and opening details reuse validated results. Old records are ignored if the transcript/version/evidence/deterministic metrics no longer match, then replaced after a successful new estimate. There is no TTL or regeneration on refresh. Failed attempts are not cached; retry requires an explicit click. Blocked/full storage returns false, leaves the result usable for the visit and shows a saving notice. Clearing browser storage or moving devices requires a new estimate. There is no hosted/shared cache or account sync yet.

API errors use safe `invalid-transcript`, `insufficient-transcript`, `malformed` or `unavailable` codes. Logs contain only event/code, section count and elapsed time; no transcript, prompt, raw output, provider endpoint, secrets or stack traces. The UI maps codes to application-owned messages and offers retry without exposing arbitrary server error strings.

## Verification

Implementation files added: `src/lib/difficulty.ts`, `src/lib/providers/difficulty.ts`, `src/lib/difficulty-api.ts`, `src/app/api/difficulty/route.ts`, `src/components/lesson-difficulty.tsx`, `src/data/demo-difficulty.json`, `tests/difficulty.test.ts`, `tests/e2e/difficulty.spec.ts` and this guide.

Existing files extended: `src/lib/types.ts`, `src/lib/storage.ts`, `src/lib/quiz.ts` (optional transcript bounds; quiz defaults unchanged), `src/lib/providers/quiz.ts` (exports existing response parsing/binding contract), `cloudflare-worker.js`, `src/components/practice.tsx`, `src/app/globals.css`, `README.md` and `PROJECT_CONTEXT.md`. Caption, translation, media-player and voice-recording implementations are unchanged.

`tests/difficulty.test.ts` covers speech calculation/boundaries/pauses/short input, strict schema/ranges/quotes/timestamps, sampling/coverage/confidence, normalized fingerprints, persistence/reload/corruption/quota, mocked native binding inputs and malformed output, timeout/cancellation and independent lesson/quiz persistence on AI failure.

`tests/e2e/difficulty.spec.ts` covers lazy generation, all five summary dimensions, expanded evidence, reload reuse, failure/malformed retry alongside playback and quizzes, the real authored-demo API, mobile overflow/touch targets, changed stored transcripts, pending inference, unavailable storage and media reattachment during analysis. Run against either production build via `PLAYWRIGHT_BASE_URL`; use separate output directories for overlapping runs. `PLAYWRIGHT_CHROME_PATH` can select installed Chrome when bundled Chromium cannot initialize Windows microphone devices.

For an entirely local built Workers preview without remote inference:

```powershell
$env:CLOUDFLARE_VITE_FORCE_LOCAL='true'
$env:YOUTUBE_CAPTION_RELAY_URL='https://example.invalid'
$env:YOUTUBE_CAPTION_RELAY_TOKEN='local-preview-unused'
npm.cmd run start:vinext -- --port 3101
```

These preview-only values enable deterministic UI/API checks and do not test live captions or AI. Keep production bindings and real relay secrets unchanged.

Implementation verification (2026-10-03): 49 unit tests pass; all 16 Playwright tests pass against both the Next.js production build and built Cloudflare Workers preview using installed Chrome (including seven difficulty tests). Lint, typecheck, Next.js build and vinext/Cloudflare build pass. Vinext reports dependency dynamic-import and route-classification warnings. Bundled Chromium failed to initialize the Windows microphone during an initial run; installed Chrome passed both success/denial tests. No live model inference or deployment was performed.
