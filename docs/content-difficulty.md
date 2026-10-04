# Content difficulty classification

Hibiki's content-difficulty card is deliberately a **classification**, not a detailed AI lesson and not a claim about the learner's proficiency.

## Output

The semantic classifier returns only closed categories:

- **Approximate level:** N5+, N5–N4, N4–N3, N3–N2, N2–N1, N1+
- **Vocabulary:** Beginner, Elementary, Intermediate, Advanced, Native
- **Grammar:** Beginner, Elementary, Intermediate, Advanced, Native
- **Conversation:** Beginner, Elementary, Intermediate, Advanced, Native
- **Speech:** Slow, Moderate, Natural, Fast, Very fast

Speech is deterministic application code. It uses Japanese-script characters per minute over captioned speaking time, including gaps up to one second and excluding longer gaps. It is not an audio-level speaking-rate or mora measurement.

## Semantic model

Canonical Cloudflare production uses the native `env.AI` binding with:

`@cf/cloudflare/clef-flash`

Jev is nominally cheaper per input token, but it is a third-party model routed through Cloudflare AI Gateway and the current project account requires funded Gateway credit/BYOK for it. Clef Flash uses the same System One decision API shape, is Cloudflare-hosted, and works through the existing Workers AI binding without another provider credential.

No Qwen generation is used for difficulty classification.

The classifier receives **only normalized Japanese transcript text**. It does not receive timestamps, segment IDs, media URLs, translations, quiz results, learner history, recordings, or user/account data.

For normal lessons the entire Japanese transcript is one decision state. To avoid silent model-side truncation on unusually large scripts, inputs above the application's conservative character budget are split into consecutive full-coverage chunks. Every chunk is classified with the same closed questions, and category probabilities/confidence are combined deterministically with character-count weighting. Nothing is sparsely sampled.

## Persistence

The result remains transcript-keyed through the existing SHA-256 fingerprint. Existing sampled difficulty caches are invalidated because the deterministic coverage strategy is now version 2 and requires full coverage.

The stored record still exposes compact numeric dimension levels for learner-progress aggregation, but it no longer stores generated evidence examples. Opening progress never triggers inference.

## Failure behavior

Difficulty inference remains optional. Provider failure, malformed output, timeout, blocked storage, or insufficient transcript never blocks playback, shadowing, completion, translation, or the comprehension check.

The bundled demo uses an authored deterministic classification and therefore does not require Workers AI.
