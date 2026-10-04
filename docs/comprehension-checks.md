# Comprehension checks

Hibiki's post-video comprehension check remains transcript-grounded, locally cached, and deterministic in scoring.

## Production AI flow

Canonical Cloudflare production uses the native `env.AI` binding in two stages:

1. **Clef Flash selector** — `@cf/cloudflare/clef-flash`
2. **Qwen generator** — `@cf/qwen/qwen3-30b-a3b-fp8`

The selector scans consecutive windows across the lesson before generation. Each window is evaluated for:

- question suitability;
- whether it is self-contained enough for a fair question;
- the best supported question type.

Selection is deterministic after those scores: Hibiki preserves lesson-wide coverage, adds useful question-type diversity, and passes at most a small set of high-value windows to Qwen.

Qwen therefore does not have to search a long transcript while simultaneously writing questions. It receives only selected windows, with each segment represented by:

`{ id, japanese }`

No timestamps, media URL, translations, recordings, learner data, or quiz history are sent to either model.

Qwen normally produces five Japanese multiple-choice questions with four options, one application-graded correct index, a concise English explanation, and exact transcript evidence. Evidence for one question must come from one selected window and reference consecutive real segment IDs. The application maps those validated IDs back to local timestamps for replay; the model never invents timestamps.

There is deliberately **no automatic regenerate-until-approved loop**. One selection pass feeds one Qwen generation pass. Existing strict application validation remains the final gate.

## Long lessons

Windows use consecutive transcript sections with overlap, so the selector covers the lesson rather than taking a sparse beginning/middle/end sample. Selector calls are batched within the decision model's typed-question limit. Only the selected candidate windows are sent to Qwen, keeping generation input bounded on long lessons.

## Validation and persistence

The application still rejects:

- malformed JSON;
- unsupported question kinds;
- duplicate questions/options;
- invalid correct indices;
- fabricated or non-consecutive evidence IDs;
- evidence text that does not exactly match the supplied lesson transcript;
- too few or too many questions.

Validated quizzes are cached against the existing transcript SHA-256 fingerprint. Retakes remain separate UUID-based attempts and application code performs all scoring.

The exact bundled demo retains its authored deterministic quiz and bypasses inference.

## Local/alternate provider

The generic OpenAI-compatible provider remains available for local development or another host through `QUIZ_API_URL`, `QUIZ_API_KEY`, and `QUIZ_MODEL`. Canonical Cloudflare production requires none of those secrets.
