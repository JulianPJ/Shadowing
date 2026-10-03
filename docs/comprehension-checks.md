# Lesson comprehension checks

After **Finish practice** in Shadowing mode, or the media ends in Continuous mode, an optional comprehension card appears. Completion is saved against the exact normalized transcript. Reopened completed lessons offer the card without interrupting playback.

The learner answers one question at a time, receives an explanation and Japanese evidence, and can replay that evidence through the existing player. Evidence playback spans the referenced consecutive sections and pauses at the final section's end, even in Continuous mode. **Return to question** restores the prior practice section and keeps answers. Answers are saved immediately; an explicit finish records the completed score. Completed checks can be reviewed or retaken.

## Server provider configuration

The demo has an authored five-question check and requires no model call. Other hosted lessons use `QuizGenerationProvider` through `POST /api/quiz`.

On Cloudflare, the production Worker handles that route with a native **Workers AI binding** (`env.AI`) and `@cf/qwen/qwen3-30b-a3b-fp8`. There is no quiz API key, endpoint secret or model-name secret in production. `cloudflare.config.ts` declares `AI: bindings.ai()`, and the Cloudflare entrypoint injects a Workers-AI-backed provider into the shared quiz request handler.

The model is used with JSON mode, Qwen's `/no_think` instruction for this structured task, bounded output, and fail-fast capacity handling. Workers AI may also expose JSON-mode output in its parsed `response` field; the adapter accepts that documented shape or a normal completed chat message, then the application strictly validates every question/evidence object.

For local Next.js development or a future alternate host, the generic OpenAI-compatible adapter remains available and can optionally read `QUIZ_API_URL`, `QUIZ_API_KEY` and `QUIZ_MODEL` from the local process environment. Those variables are not required by the canonical Cloudflare deployment.

Only normalized Japanese segment text/IDs go to generation. Media, recordings, learner answers, translation cache and bookmarks are excluded. The UI discloses transcript use before generating a new check. Provider response text and credentials are never included in client errors or logs.

## Validation and failure behavior

Accept 3–7 distinct questions, four unique options and one integer correct index per question. All question kinds, field names and bounded text are validated. Evidence must quote the full text of consecutive normalized segments; the app derives fractional start/end times and rejects fabricated quotes or timestamps. The provider is instructed to use only transcript information and avoid ambiguous options. Structural/evidence validation does not mechanically prove a model's semantic interpretation; question quality still depends on the configured provider.

The application scores selected indexes against validated correct indexes. It never asks a model to grade an attempt.

Input is limited to 2,000 normalized sections / 60,000 Japanese characters / a 350 KB request. Longer transcripts are rejected with a recoverable message rather than silently truncating the lesson. Upstream output is capped at 100 KB and generation times out after 35 seconds. Empty, malformed, incomplete, unavailable and unconfigured responses cannot block practice. Retrying never discards a completed lesson.

## Local contracts and future sync

The existing `hibiki:v1:` storage helpers store:

- `completion:<lessonId>`: lesson completion tied to its transcript revision.
- `quiz:<lessonId>`: validated `LessonQuiz`, keyed logically by lesson ID, schema version and SHA-256 transcript fingerprint (segment IDs, Japanese text, fractional timings). Reuse survives reload and media reattachment; transcript changes invalidate the cached check.
- `quiz-attempt:<quizId>`: latest attempt/draft for resumption.
- `quiz-attempts`: history of `QuizAttempt` events, upserted by stable UUID. Retakes get new UUIDs; completion updates the same attempt. This history is independent of the eight-item recent-lessons limit.

`QuizAttempt` contains schema version, UUID, lesson/video/quiz IDs, transcript fingerprint, attempted status, start/update/completion ISO timestamps, deterministic score, total questions, and per-question selected/correct options, question kind, correctness and evidence segment IDs/quote/times. Incomplete attempts have `completedAt: null`. These portable events can later sync by UUID into an account's learner history. No account or learner-profile implementation is included here.

Stored quizzes/drafts are validated on read. Storage quota/private-mode failures leave the in-memory quiz usable and show that results could not be saved. Browser-local storage is currently the only persistence; clearing it removes the checks.

## Verification

`tests/quiz.test.ts` tests validation, deterministic scoring, fractional/multisegment evidence, transcript invalidation, completion, drafts/history/retakes, corruption/quota recovery, bounded requests/responses and mocked provider integration. The normal unit suite never contacts generation services.

`tests/e2e/quiz.spec.ts` covers completion in both playback modes, answering/feedback, evidence seeking/stop/return, reload recovery, result persistence/cache reuse, provider/malformed recovery and mobile overflow/touch targets. Generation is intercepted except for a real bundled-demo API smoke test, which requires no provider secrets. Run against Next.js or the built Cloudflare preview using `PLAYWRIGHT_BASE_URL`.
