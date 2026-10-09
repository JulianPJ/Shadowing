# Local learner progress (roadmap priority 3)

The dedicated `/progress` page is reachable through the existing header. Learning
signals remain in the current browser/origin. No profile request, AI inference,
analytics endpoint, account, audio upload or hosted storage was added. Existing
quiz and difficulty generation are unchanged; progress reads their saved results.

## Contracts and sources of truth

`learner-types.ts` defines explicit schema-version-1 `PracticeSession`,
`PracticeArchive`, `DifficultyReference`, `LearnerHistory` and `LearnerProfile`
contracts. `learner-progress.ts` owns validation and pure aggregation;
`learner-storage.ts` owns migration, reads and session upserts. The browser hook
connects the practice actions to these libraries.

A session has a UUID, compact lesson metadata (ID, optional video ID, title,
author, source, duration, section count), the existing SHA-256 transcript
fingerprint, origin, start/update/end dates, completion boolean and optional date,
active seconds by UTC day, last practised section, and compact section counts.
Section entries contain only ID/times, replay counts, evidence-replay counts,
translation-reveal count/ever-used boolean, and recording-attempt counts.
There are no Japanese sentences, translations, full difficulty explanations,
quiz contents, inference inputs, blobs or media URLs in learner-history records.

`QuizAttempt` and `quiz-attempts` remain the only quiz-history source. Portable
attempts are structurally validated (dates, score, correctness, options, evidence
IDs/times) even when the original quiz/transcript is no longer present. Without
that transcript, evidence text cannot be re-grounded, a limitation of historical
records. Existing save-time quiz/evidence validation remains intact. Retakes
retain their UUIDs. Completed attempts feed lifetime/recent correct/total;
incomplete attempts remain visible and their already-answered misses feed section
attention. Incorrect evidence IDs remain available in the result history even
when old lesson metadata is missing.

Difficulty references are copied only from an existing validated
`ContentDifficultyAnalysis`. They contain analysis ID, lesson ID, transcript
fingerprint, generation date, JLPT endpoints and the four dimension levels.
They are keyed by lesson **and transcript**, remain available after transcript
edits, and can join practice recorded before analysis. No inference is triggered
by opening progress. Bookmarks use the existing favourites state, so removing a
bookmark removes that reason rather than increasing a lifetime bookmark counter.

## Existing localStorage inventory

Every key below uses the existing `hibiki:v1:` prefix.

| Key | Meaning |
| --- | --- |
| `lesson:{id}` | Saved full lesson; upload media URL omitted |
| `history` | Latest eight lesson snapshots and positions; state, not full learning history |
| `position:{id}` | Latest section index |
| `preferences` | Playback mode/speed preferences |
| `reveal:{lesson}:{section}` | Current reveal boolean, no historical count/date |
| `translations:{id}` | Translation cache, no learning event |
| `favorites:{id}` | Current saved-section IDs |
| `completion:{id}` | Completion for exact serialized transcript revision, optional timestamp |
| `quiz:{id}` | Validated quiz cache for current transcript |
| `quiz-attempt:{quizId}` | Resumable/current attempt state |
| `quiz-attempts` | Independent versioned quiz attempt history, upserted by UUID |
| `difficulty:{id}` | Validated difficulty cache for current transcript |
| `learner-history` | New versioned session history, retention archives and compact difficulty references |

The resume token is `hibiki:practice-session:{lessonId}` in **sessionStorage**,
not localStorage. It is a browser-tab reload aid, not an account identity.

## Active time and writes

Elapsed time uses `performance.now()`, sampled once per second. Opening or
restoring the player alone grants no time. Only a visible practice document can
accumulate time, under at least one of these conditions:

* The player is listening/playing **and its adapter time is advancing**, or
  MediaRecorder is recording. A 1s media-time sample prevents stalled downloads
  from keeping a stale listening status active indefinitely.
* A deliberate click or non-repeat key interaction occurred in the last 30s.
* The player entered `your-turn` (a Shadowing boundary or pausing the source
  to prepare/finish a recording): the spoken-response window is
  `clamp(2 × sectionDuration / playbackSpeed + 5 seconds, 10 seconds, 60 seconds)`.

The response and interaction windows combine using their later expiry; starting
one never shortens the other.

Hidden tabs and pagehide stop accrual. Quiz-open (including generation and
evidence replay) and difficulty-generation waiting override all active conditions.
Interactions during those exclusions cannot extend the clock. Closing the check
does not manufacture quiz practice time. Interactions after returning can start
practice again. Sampling gaps over 2s are discarded to avoid counting computer
sleep, suspended JS and long blocked main-thread periods. This is deliberately
conservative: it can undercount, but does not convert wall-clock page age into
practice time. Spoken practice beyond the bounded window needs another interaction.

`PracticeCheckpoint` writes dirty active time at 15s intervals; raw 1s samples
never write storage. Deliberate signals use a 1s debounce, completion writes
immediately, and hide/pagehide/unmount flush outstanding time/signals. Pageshow
restores the visibility gate. Per-day attribution uses UTC and puts the small
sample interval in its ending day. Wall dates identify events but do not calculate
elapsed practice; session update dates are clamped to be nondecreasing if the
device clock goes backwards.

## Session boundaries and action semantics

The same tab can resume the same session UUID for the same lesson/fingerprint
when the saved last update is **less than 30 minutes** old. At exactly 30 minutes,
after a longer idle/hidden gap or after a transcript change, the
next activity creates another UUID. Reloads do not double-add time: the stored
total is loaded and only new monotonic intervals are added. A new tab without a
resume token gets its own session. Duplicate-tab sessionStorage copies and
simultaneous localStorage writers are best-effort browser behavior; this version
does not provide cross-tab transactional locking.

* Normal replay means the explicit Replay button or R shortcut only. Initial
  listen, previous/next, transcript seeking, playback setup and continuing are
  not replay events. Quiz evidence replay has its own count and is excluded
  from shadowing time. The old transient `practiceCount` remains UI-only.
* An explicit reveal records one reveal and sets `translationHelp`. Mounting,
  cached translation presence, hiding, and restoration record no reveal.
  A failed translation request still records that help was requested.
* Bookmark actions preserve the existing favourites UX and storage. Current
  valid section IDs are derived from that state, not add/remove counters. If a
  lesson has been removed, its last known revision and captured compact section
  metadata can still establish known saved sections without a practice link.
* A recording attempt counts once **after MediaRecorder.start succeeds**.
  Permission denial/cancellation and recorded-audio playback do not create an
  attempt. Audio remains in memory and is cleared on section change as before.

## Deterministic profile and content algorithms

The profile derives distinct practised/completed lesson counts, session count,
lifetime and trailing-30-UTC-day active time, ordinary/evidence replay totals,
translation count and number of sections ever helped, recording attempts,
current bookmarks, quiz attempts/completions/lifetime/recent results/misses,
revision-specific lesson activity, compact difficulty dimensions, and section
attention reasons. Preparation alone is not evidence of practice. A lesson is
practised when measured active time, an explicit replay/reveal/recording, or a
known completion exists. Distinct/completed counts deduplicate lesson IDs;
individual revision histories remain separate.

Typical content takes the most recently **practised** revision of each unique
lesson; a stale estimate on a different revision cannot qualify. It uses at most
20 most recent qualifying analyzed lessons. Each unique lesson gets one vote,
regardless of refreshes, repeated sessions or media length. At least **five** are
required. Levels map N5 through N1 to ordered indices 0 through 4. The median of
the lower endpoints and the median of the upper endpoints are rounded to the
nearest level. One outlier cannot dominate a five-lesson median. No learner
proficiency or certified JLPT level is inferred.

Trend requires **ten** qualifying unique lessons. Compare median JLPT range
midpoints in the five most recent and the preceding five. A difference of at
least +0.5 ordered level is `harder`, at most -0.5 is `easier`; otherwise `similar`.
Only plain-language direction is displayed, without numerical precision.

Attention is revision/section-specific. Ranking constants live in
`ATTENTION_WEIGHTS`: one point per ordinary replay, two if translation was ever
used, two for a current bookmark, three per incorrect quiz question referencing
the section, and one per recording attempt after the first. Quiz evidence replay
does not raise this ranking. Ties use stable lesson/revision/start/section order.
The UI displays actual reason labels and counts, not the numeric rank. This is
an explainable ordering of actions, not a scientific measure of difficulty. It
does not create review sessions or recommendations.

## Backfill and storage bounds

Migration scans uncapped `lesson:*` keys plus recent/quiz identities, validates
lessons, hashes their current transcript, and creates one legacy observation per
lesson/revision using a deterministic UUID. It is idempotent and leaves old keys
intact. Known history `updatedAt`, exact-revision completion boolean/date, position,
and ever-revealed state are preserved. Unknown start/reveal timestamps remain
unknown; reveal counts and historical active time stay zero. If no observation
date exists, the legacy record uses an explicitly displayed unknown-date epoch
sentinel, never a claimed practice date. Preparation metadata is shown as an
earlier saved lesson, not added to the practised total. Difficulty caches are
validated and imported as references. Existing quiz UUID history is read directly.
Damaged JSON, invalid records and unsupported schemas are safely isolated.

Retain the **500 most recent detailed sessions**. Older records compact atomically
within the same history envelope into one archive per lesson/transcript revision,
preserving session count, lifetime totals, UTC daily totals, completion, metadata
and all compact section signals. Archived individual session boundaries are lost;
recent detail remains. Repeating compaction cannot double-add totals. Legacy
observations contribute zero to measured session count/time. Archives are bounded
at **2,000 revisions**, and the whole learner envelope at approximately **2MB**
(`JSON length × 2`, conservative UTF-16 estimate). Beyond those bounds, refuse the
new history write and display the saving warning; never silently delete lifetime
facts to squeeze into the cap. Existing lesson/quiz cache limits are unchanged.

Quota/private-mode errors never throw into playback. Failed writes keep an
in-memory copy for client-side navigation during the visit and display
“Progress for this visit may not be saved.” A full reload can lose that fallback.
The origin's existing lesson/translation/quiz data share browser quota, and older
quiz-attempt history keeps its existing retention policy. Clearing browser data
removes progress; there is no export, hosted backup or device sync in this task.

Versioned UUID session/quiz records and transcript identities support later
idempotent sync. Revision archives are compaction snapshots, not independent
events: a future sync implementation must reconcile archive ownership before
unioning old detailed events, rather than adding both representations. No sync
API or account architecture was added.

## Verification and limitations

Unit tests cover validation, identity/upsert/resume, multiple sessions, clock
exclusions/response windows, checkpoint frequency/failure, signal semantics,
retakes/missed evidence, content association/median/trend, migration/corruption,
retention and deterministic aggregation. Playwright covers empty/mobile progress,
practice/signals/reload/links, real recording metadata, completion and quiz
retakes, later sessions/missing lessons, later difficulty association, checkpoint
writes and blocked storage. No deterministic suite calls live inference.

The browser suite uses a real MediaRecorder with Chromium's fake microphone.
On this Windows environment, bundled Chromium returns `NotSupportedError` before
recording and does not reproduce permission denial correctly. Use the existing
`PLAYWRIGHT_CHROME_PATH` option to select installed Chrome, as documented in
`content-difficulty.md`. Browser checks run against the built preview
(`npm run start:test`), which has no remote bindings, so no live caption or AI
service is contacted.

This feature cannot know whether the learner actually spoke during the response
window, reconstruct pre-feature replay/recording counts, or infer unseen historical
transcript revisions. History links require a locally available lesson; historical
section rows show compact timestamps/reasons without building weak-section review.
Local media still needs reattachment after a full reload. Concurrent tabs are
best-effort and not a substitute for future transactional account sync.
