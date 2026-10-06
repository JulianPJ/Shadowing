# Adaptive immersion, speaking and discovery

This implements the three remaining phases in the recommended build order of [the competitive roadmap](post-mvp-competitive-roadmap.md), on top of the completed Phase A retention loop. Hibiki remains a Japanese-first player for authentic media: listen, pause, repeat, compare, understand and retain.

## The product loop

Home gives the learner a quick way to continue an unfinished lesson or prepare a queued link. My Library holds available lessons, completion filters, deliberately saved lessons and a watch-later queue. Personal recommendations combine complete public/prepared captions with the learner's explicit word states and existing content estimates; insufficient evidence produces an abstention rather than an invented ability estimate.

During practice, dictionary lookup uses licensed Japanese lexical data. Known/Learning/Unknown/Ignored states carry across lessons. A compact vocabulary panel explains its denominator and surfaces short, reliable sections with one Unknown word or recurring words worth practising. Selected vocabulary still feeds Phase A's contextual dictionary, decks and Daily Review. The original sentence and playback remain the centre of the experience.

Speaking presets expose their repeat count, pause behaviour, translation reveal and response window. Support reveals help after a pause. Drill repeats the source and offers opt-in hands-free local recording. Recognized wording, alignment omissions/substitutions, recording duration and comparable recent attempts make the existing Shadowing Match signal actionable without changing its score calibration or claiming phonetic diagnosis.

The weekly report closes the next-visit loop with real active practice time, explicit section actions, current word-state changes, saved terms, self-rated review recall and retained Match attempts. An optional minutes goal offers a calm invitation, without penalties or streaks.

## What we take from competitors

| Pattern | Hibiki implementation |
| --- | --- |
| Migaku's cumulative immersion and sentence mining | Explicit lemma knowledge, personal vocabulary coverage, useful lines and explainable next lessons |
| LingQ's vocabulary continuity | Free global word states, cross-video highlighting and a bulk Word Browser |
| Yomitan's lexical depth | Full English JMdict, contextual lemma/deinflection, reading restrictions, parts of speech, multiple senses and commonness markers |
| Language Reactor / Lingopie viewing ergonomics | Visible repeat/pause/reveal settings using the existing mounted player and exact section boundaries |
| Miraa's listen / imitate / compare loop | Local record-and-compare, recognizer alignment evidence and explicitly initiated hands-free drills |
| Todaii / Migaku return surfaces | Continue Watching, a personal queue and evidence-based weekly reporting |

The Phase A memory loop stays useful on Free. Word knowledge and dictionary lookup do not introduce inference fees or a paid gate. Existing variable-cost AI access rules remain in place. Native lexical audio is not bundled without an appropriate licensed source; existing original sentence audio stays available through source replay. Grammar Coach, a generic conversation tutor, licensed streaming catalogues and reader/OCR parity are separate roadmap items rather than prerequisites of phases B–D.

## Persistence and runtime

- JMdict assets are pinned by source SHA-256, prepared reproducibly and served as lazy static shards. They are excluded from the browser entry and Worker bundles. Attribution and ShareAlike notices accompany the derived data.
- Word knowledge saves locally immediately. Verified accounts synchronize through `/api/knowledge`, with account-derived ownership, origin checks, paginated reads, deterministic merges and a durable outbox. The existing anonymous-import prompt explicitly includes word states; declining leaves anonymous records separate.
- Queues, saved-library choices, goals, compact speaking trends and review event history stay local and account scoped. Private transcripts, media, recordings and recognized text do not enter these hosted state endpoints.
- Cloudflare's `/api/discovery` reads only validated, ownerless system YouTube provider captions and matching difficulty artifacts. It returns complete bounded candidates, checks official metadata and omits unavailable videos. It performs no recommendation inference. Next development supplies an empty hosted index and retains local recommendations.
- Migration `0009_word_knowledge.sql` must be applied before releasing the Worker. The existing deployment script applies migrations first. No production migration or deployment is performed as part of opening this PR.

Detailed contracts live in [adaptive immersion](adaptive-immersion.md), [speaking presets and evidence](speaking-drills.md), and [library and reporting](library-and-reports.md). Existing storage keys, score constants, public library facades, transcript hashes and player timing tolerances remain compatibility boundaries.

## Verification

Focused browser checks cover dictionary senses/deinflection and saving, state changes and bulk actions, cross-video persistence and highlighting, coverage and recommended-line filters, explicit account import/decline/isolation, repeat/reveal/timed/hands-free drill behaviour, microphone denial and interruption, score diagnostics and persistent trends, library queue/completion, trusted recommendation inputs, report/goal persistence and mobile width.

Run the full unit suite, typecheck, lint and formatting checks; build both Next and vinext; run Playwright against both production builds. The local native D1 migration check and built Worker/D1 integration test verify the new ownership and runtime paths without calling live AI or caption providers. Browser fixtures use real local JMdict/Kuromoji assets and deterministic provider responses. Semantic recognizer quality, real-provider availability and fit thresholds remain subjects for product iteration.
