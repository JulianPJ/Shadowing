# Shadowing scoring v1

Hibiki's shadowing score is a practice aid, not a scientific pronunciation assessment. The numeric score is deterministic. Cloudflare Workers AI is used only to transcribe a learner-selected recording and to phrase concise feedback from already-computed signals.

## Flow

1. The learner records locally with the existing MediaRecorder flow.
2. Nothing leaves the browser until the learner explicitly chooses **Analyse attempt**.
3. The selected recording is sent to the Hibiki Worker and transcribed with `@cf/openai/whisper-large-v3-turbo`.
4. The browser converts target and recognized Japanese to readings with Hibiki's existing local Kuromoji assets where available, normalizes them, aligns mora-like units, and computes the score.
5. The structured result is sent to Qwen only for concise wording. Qwen has no authority to calculate or modify the numeric score.
6. The latest valid score for each stable section ID is kept in sessionStorage. Raw recordings are never stored there.
7. On video completion, the arithmetic mean of the latest valid unique-section scores is shown with coverage. Qwen may summarize the structured session data; no recordings are resent.

## Whisper configuration

Model: `@cf/openai/whisper-large-v3-turbo`.

The scoring transcription request uses:

- `task: "transcribe"`
- `language: "ja"`
- `vad_filter: true`
- `condition_on_previous_text: false`
- `no_speech_threshold: 0.55`
- `compression_ratio_threshold: 2.4`
- `log_prob_threshold: -1`
- `hallucination_silence_threshold: 1`

It deliberately does **not** send `initial_prompt`, `prefix`, the target sentence, or another reference that could bias recognition toward the expected answer.

## Deterministic Japanese comparison

When local Kuromoji readings are available, kanji tokens are replaced by their dictionary readings before comparison. If local readings are unavailable, Hibiki falls back to the original text rather than making a network request.

Normalization is deterministic:

- Unicode NFKC;
- katakana to hiragana;
- lowercase Latin text;
- historical kana `ゐ/ヰ → い`, `ゑ/ヱ → え`;
- remove Unicode punctuation, symbols, separators, and whitespace;
- join small kana such as `ゃ/ゅ/ょ` to the previous unit to form mora-like comparison units.

A dynamic-programming alignment then chooses matches, substitutions, deletions, and insertions. Stable tie-breaking prefers diagonal alignment, then deletion, then insertion.

V1 edit costs:

- match: 0
- substitution: 1.0
- deletion: 1.0
- insertion: 0.75

`contentSimilarity = clamp(1 - weightedEditCost / targetUnitCount, 0, 1)`.

## Timing and final score

`durationRatio = recognizedSpeechDuration / sourceSectionDuration`.

Timing is symmetric for equally fast and slow speech by operating in log-ratio space:

- within ±10% duration: `timingSimilarity = 1`;
- after that, similarity decreases linearly with `abs(log2(durationRatio))`;
- at half or double the source duration: `timingSimilarity = 0`.

The exact V1 formula is:

`sectionScore = round(100 × (0.80 × contentSimilarity + 0.20 × timingSimilarity))`.

Content and timing sub-scores are also rounded to whole-number percentages for display/debugging.

No score is returned for missing target speech, invalid timing, less than 0.35 seconds of recognized speech, an attempt that is both under 25% of the target duration and under 20% of the target pronunciation units, or extreme repetitive/overlong recognition that is too unreliable to compare.

## Retakes and aggregate

A successful retake replaces the previous contribution for that section. A failed transcription or invalid scoring attempt leaves the previous valid score intact.

For a completed session:

`overallShadowingScore = round(sum(latestValidScorePerScoredSection) / scoredSectionCount)`.

Unattempted sections are excluded. Coverage is always displayed as `scoredSectionCount / totalLessonSections`. If no section has a valid score, the completion UI does not show a shadowing score.

Session state is stored under a key derived from the lesson ID plus a deterministic hash of stable section IDs and Japanese text, preventing scores from one video/transcript revision from being mixed into another. **Practice again** starts a fresh shadowing-scoring session.

## Privacy, security, and cost controls

- Raw recordings remain browser-local unless **Analyse attempt** is selected.
- A selected recording travels browser → Hibiki Worker → Workers AI Whisper.
- Raw audio is never written to D1, R2, localStorage, sessionStorage, or application logs.
- Per-attempt Qwen feedback receives only target/recognized text and deterministic structured signals.
- End-of-video Qwen feedback receives only structured section results and aggregate signals, never audio.
- Audio requests are same-origin, `audio/*` only, bounded to 8 MB, and the captured attempt must be between 0.2 and 65 seconds.
- JSON feedback/summary bodies and field sizes are bounded.
- The Worker uses a Cloudflare rate-limit binding for shadowing AI endpoints.
- The client permits one in-flight analysis for a recorder and aborts superseded work.
- Qwen is called at most once after each valid scored attempt and once for a completed scored session. Deterministic fallback feedback remains available if Qwen fails.

## Evaluation and calibration

Do not describe V1 as scientifically validated. Before changing the constants based on intuition, build a small labelled evaluation set with real Japanese learner recordings for each of:

- native/correct reading;
- correct but slower reading;
- one omitted word;
- deliberately changed word;
- unclear pronunciation;
- substantially incorrect reading;
- silence/noise.

For each recording, retain the target, independent human judgement, Whisper transcript, deterministic alignment, content/timing sub-scores, and final score. Evaluate whether ordering and score bands match human judgements, inspect systematic Whisper errors by learner/accent/noise condition, and adjust constants only with versioned tests and documented evidence. Pitch-accent grading is explicitly out of scope for V1.
