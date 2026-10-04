# Comprehension checks

Hibiki's post-video comprehension check remains transcript-grounded, locally cached, and deterministic in scoring.

## Production AI flow

Canonical Cloudflare production uses the native `env.AI` binding with adaptive routing:

1. **Normal lessons** go directly to `@cf/qwen/qwen3-30b-a3b-fp8` with the complete Japanese transcript.
2. **Very large lessons** first use `@cf/cloudflare/clef-flash` to identify useful regions across the lesson, then Qwen generates the final quiz from expanded context around those anchors.

Qwen's Cloudflare-hosted model has a 32,768-token context window. Japanese characters are not equivalent to model tokens, so Hibiki does not try to run near that hard limit. The current routing ceiling is a conservative **12,000 non-whitespace Japanese transcript characters**. This leaves substantial room for the system prompt, segment IDs/JSON structure and up to 3,000 completion tokens.

A normal lesson is sent as:

`{ "segments": [{ "id": "...", "japanese": "..." }] }`

No timestamps, media URL, translations, recordings, learner data or quiz history are sent to the model.

## Large-lesson selection

When the transcript exceeds the conservative direct-Qwen ceiling, Clef Flash evaluates overlapping eight-segment anchors across the whole lesson for:

- question suitability;
- whether the anchor contains enough meaning to support a fair question;
- the best supported question type.

Hibiki then selects a small set of strong, geographically distributed anchors and expands each selected anchor to as many as 18 consecutive transcript segments before sending them to Qwen. Clef therefore guides *where* Qwen should look without forcing Qwen to work from the tiny selector window itself.

Selector calls are batched within the typed-question limit. There is no sparse beginning/middle/end sample and no regenerate-until-approved loop.

## Generation contract

Qwen normally produces five Japanese multiple-choice questions with:

- four options;
- exactly one application-graded correct index;
- a concise English explanation;
- exact transcript evidence.

Question generation is explicitly content-first. Segment IDs and window boundaries are application metadata only and must never appear in learner-facing questions, options or explanations. The prompt prioritizes main ideas, important details, reasons/causes, speaker intent or viewpoint, meaningful sequence, and directly supported inference. Vocabulary/grammar/reference questions are allowed only when they test an important expression in context rather than serving as filler.

The generator is also told to avoid trivial questions about greetings, self-introductions, podcast names, timestamps, section numbers, or other incidental transcript structure unless such information is genuinely central to the lesson.

For complete-transcript input, evidence can use any 1–24 consecutive supplied segments. For selected-window input, evidence must stay inside one supplied expanded window. Application code maps validated segment IDs back to local timestamps for replay; the model never invents timestamps.

The application performs a deterministic minimum-content check before inference. Once a transcript passes that check, Qwen is instructed to produce 3–7 questions rather than return an empty quiz. If an upstream model nevertheless returns `{"questions":[]}`, Hibiki treats that as a malformed generation result, not as proof that a substantial transcript was insufficient.

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

The generic OpenAI-compatible provider remains available for local development or another host through `QUIZ_API_URL`, `QUIZ_API_KEY`, and `QUIZ_MODEL`. It receives the complete compact transcript; canonical Cloudflare production performs the adaptive Clef/Qwen routing and requires none of those secrets.
