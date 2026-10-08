# UX audit implementation

This implements the core-loop backlog from [audit PR #35](https://github.com/JulianPJ/Shadowing/pull/35) on main `3dee7791af3d29afa8b1f15e5e9ae6ce3da1ac31`. The audit remains documentation-only. The product remains centred on **listen → pause → repeat → compare → continue**, with contextual vocabulary and review feeding back into authentic-media practice.

## Changes and audit coverage

| Audit tasks | Result                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1–N4       | Shared navigation, mobile menu and account drawer; Vocabulary groups Saved words, Decks, Review and Word knowledge; validated task return through authentication; exact short-lived paused playback return.                                            |
| H1–H4       | Supported-link guidance, retained-input retry, distinct preparation/queue/import actions and a compact returning-learner home.                                                                                                                         |
| L1–L4       | Resume/practise-again actions, clear device/account ownership, appropriate notices and staged recommendation/loading explanations.                                                                                                                     |
| P1–P8       | Canonical Japanese lexical spans, keyboard/touch phrase selection, separate transcript play/lookup, Studio theme/layout, described presets and advanced settings, accessible local recording controls, compact lesson navigation.                      |
| C1–C3       | Compact completion choices, persistent bounded quiz evidence replay, and understandable difficulty estimates with optional methodology.                                                                                                                |
| F1–F10      | Scheduler-derived intervals, explicit learning steps and reentry, remaining-today study, unrestricted due backlog, configurable daily limits, source context, hidden readings, resumable sessions and guarded undo.                                    |
| D1–D6       | Dedicated deck management, independent assignment destination, clear bulk/export scope, visible tags, chosen sense and optional translation, revision-aware source links.                                                                              |
| W1–W3       | Distinct knowledge/card concepts, partial search, dictionary-download guidance, predictable bulk scope and vocabulary-coverage explanations.                                                                                                           |
| G1–G5       | Actionable attention/quiz history, useful progress hierarchy, local study days, explicit partial/self-rated metrics and editable goals.                                                                                                                |
| A1–A5       | Routine account drawer, aggregate sync states and recovery, task-preserving sign-in, password visibility and truthful Free/Pro presentation. Billing remains outside this change.                                                                      |
| X1–X5       | Larger primary targets, readable lookup controls, visible focus, practical word navigation, touch selection, input-safe shortcuts and task-specific recovery states. Automated browser coverage exercises complete journeys, including narrow layouts. |

These rows describe implemented behaviour. They do not imply a formal WCAG certification or successful production provider/account smoke test.

## Compatibility and release

- Media adapters, mounted-player ownership, section timing tolerances and optional AI/provider infrastructure remain intact.
- Existing storage keys, public facades, UTC event timestamps, transcript fingerprints and legacy schedules remain compatible. New learner activity metadata is optional; historical UTC activity is labelled rather than silently redated.
- New cards use learning/relearning steps. Mature cards retain the existing long-term scheduler; this change does not adopt FSRS or promise Anki scheduling parity.
- Global and per-deck study limits use the existing preferences sync channel. Today-only extensions are explicitly device-local. Authoritative recent grade events support cross-device daily counts; optimistic offline operations and guarded undo reconcile against that history.
- Apply **`0010_review_limits.sql` and `0011_review_events.sql` before releasing the application**. Both are additive. Production migration and deployment remain separate release actions.
- Playback return is a bounded session-only snapshot and restores paused. Explicit source/section/quiz links take precedence; changed transcript, media source, account or expired snapshots are rejected. It does not persist recordings.

## Verification scope

The public production Home, demo, requested practice route and standalone destinations were inspected anonymously in Chromium. Local browser tests use actual lexical assets, native media and MediaRecorder where applicable, with deterministic account, caption and AI fixtures. Real email/Google authentication, a real Pro account and paid-provider smoke checks require release credentials and remain separate from these local results.

The implementation pull request records the final local results and CI run. The `Playwright` workflow verifies its exact head with type checking, lint, formatting, the complete unit suite, both production builds, the full browser suite on each runtime, all local D1 migrations and the built Worker/D1 boundary. No live provider access is inferred from these deterministic tests.
