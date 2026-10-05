# Shadowing Match V1 evaluation plan

Shadowing Match V1 is a deterministic practice signal built from speech recognition and pacing. It is **not scientifically validated pronunciation grading** and must not be presented as such.

## What V1 measures

For each explicitly analysed recording:

1. Cloudflare Whisper Large V3 Turbo independently transcribes Japanese speech.
2. Hibiki locally normalises the target and recognised text, preferring Kuromoji-derived kana readings when available.
3. Deterministic sequence alignment produces content similarity and structured insertions/deletions/substitutions.
4. Recognised speech duration is compared with the reference section duration at the learner's selected playback speed.
5. The displayed score is 80% content similarity and 20% pacing similarity.

Whisper recognition error is an important confounder: a mismatch means the attempt was not recognised as expected, not necessarily that the learner made a specific phonetic error. V1 deliberately does not grade pitch accent.

## Calibration set

Before changing score thresholds or claiming learning validity, collect consented Japanese readings spanning:

| Case | Purpose |
| --- | --- |
| Native/correct reading | Check the top end and ordinary ASR variation |
| Correct but slower reading | Calibrate timing penalty independently of content |
| Correct but faster reading | Check timing symmetry |
| One omitted word/ending | Check deletion penalty and feedback |
| Deliberately changed word | Check substitution penalty |
| Added filler/word | Check insertion penalty |
| Intentionally unclear pronunciation | Observe ASR mismatch without overclaiming diagnosis |
| Substantially incorrect reading | Check lower-end separation |
| Silence/background noise | Verify invalid/retry handling |

Use several target lengths and at least several speakers. Keep the raw evaluation recordings outside production learner storage and only with explicit evaluation consent.

## Review protocol

For every sample, retain an evaluation row containing the target, human-described condition, Whisper text, deterministic alignment, content score, timing score, final score, and any Qwen/fallback feedback. Compare repeat runs of the deterministic scorer for exact reproducibility.

A Japanese-speaking reviewer should independently rate whether the content was faithfully spoken and whether the pacing was close enough for shadowing practice. Compare those human judgements with score bands rather than tuning to one speaker.

Specifically look for false confidence caused by:
- Whisper correcting a learner's speech toward a plausible sentence;
- Whisper mistakes on otherwise good speech;
- names, numbers, loanwords, or uncommon kanji readings;
- dialect/accent variation;
- very short sections where one edit dominates;
- long sections where edit distance can hide a locally important omission.

## Calibration decisions

Only adjust centralized constants in `src/lib/shadowing-score.ts`. Any change should add/adjust deterministic fixtures and record why the new constants better separate the evaluation cases.

Useful calibration questions:
- Do clearly correct readings cluster near the top without requiring 100?
- Does a single omitted ending cause a noticeable but not catastrophic penalty?
- Are 0.5x/0.75x practice-speed recordings judged against the timing the learner actually heard?
- Do fast and slow deviations of the same ratio receive comparable penalties?
- Do silence/noise and extremely short speech reliably produce retry states rather than scores?

Do not introduce pitch-accent scoring in V1. If phoneme- or mora-level acoustic grading is added later, evaluate it as a separate metric rather than silently changing the meaning of Shadowing Match.
