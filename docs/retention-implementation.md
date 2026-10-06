# Phase A retention implementation

## Phase A.2 — completion and scale

**Phase A complete:** the PR #31 foundation is extended with lightweight tags, bounded dictionary retrieval, explicit complete exports and a unified lesson completion summary. Release verification for this slice is recorded in its PR. Phase B is the next product stage; no adaptive-learning feature is part of this slice.

### Dictionary query contract

`GET /api/dictionary` returns `{ entries, nextCursor }`, default/max 100 records. Ordering is immutable `created_at DESC, id DESC`; the versioned base64 cursor contains only that tuple. Decoding validates its version, canonical UTC timestamp and bounded ID before binding values to fixed SQL. Invalid cursors/page sizes/unknown or repeated query fields return 400. Deleting a cursor row does not shift the following page. New captures appear on a fresh first page; pagination is a live keyset traversal, not a transaction snapshot.

Optional AND filters: exact NFKC-normalized `term`, `deckId`, `tagId`, `lessonId`, and `transcriptKey` (requires lesson identity). Lesson recap pages only the current lesson/transcript revision, including an explicit Load more for large lesson vocabulary. Personal Dictionary uses ordinary pages and Load more. The only new dictionary indexes support the actual tuple order and lesson/revision lookup; existing term and membership indexes support the filters. There is no search service.

`GET /api/dictionary?ids=id1,id2` accepts at most 50 IDs, deduplicates them, and permits no other query fields. Every read uses the session owner. Missing/foreign IDs return 404 without returning any material or revealing the owner. Daily Review hydrates at most its next 20 due entries plus the active session, rather than listing the dictionary. The existing `list()` repository facade remains compatible through explicit page traversal; interactive consumers use bounded queries.

### Browser cache and offline review

The existing account-scoped `dictionary:entries` key evolves from an array to a version-2 record map keyed by stable entry ID. Legacy arrays migrate on read. Pages, targeted lookups, and saves merge records; newer `updatedAt` wins and request-start order breaks equal-date races. Confirmed deletions remove records and keep bounded tombstones to fence late responses. No record crosses the existing account namespace; both the client cache selector and expected-account/session check must still match before a network result is consumed. 401/403/404/409 and validation errors never fall back to another cache.

The cache retains at most 700 records and a 3 MB UTF-8 record budget. Exact-ID review hydration gives priority to up to 200 recently hydrated review entries, subject to the byte budget. Ordinary dictionary pages and full exports cannot evict these entries in favour of unrelated words. Offline review uses hydrated material; uncached due entries remain scheduled and the UI explains that material needs a connection. This is a bounded device cache, not a downloaded copy of every remote word. Storage failures use the existing visit-memory fallback and warning. Remote page contents and exports remain complete even when the cache cannot retain them all.

Review/deck writes retain PR #31's durable local-first outbox, revisions and operation IDs. New dictionary creation and tag edits require a connection. Tags do not enter the review operation protocol or alter SRS.

Server-filtered deck pages refresh after pending review/deck edits are acknowledged, and superseded page requests cannot replace that refresh. Edits queued during the final review snapshot are drained under the existing account lock immediately, without waiting for a timer.

### Tags and migration 0008

`0008_tags_dictionary_pagination.sql` is additive to the existing retention data. It creates `user_tags` and `user_dictionary_tags`, with composite owner/tag and owner/entry foreign keys. Tag deletion removes memberships; dictionary/review records survive. Entry/account deletion cascades. Migration 0007 and existing schedule data are unchanged.

Names use NFKC, trim and whitespace collapse; display casing is retained and normalized lowercase uniqueness is enforced within the account. Japanese is valid. Limits: 64 UTF-16 code units per display name, 100 tags/account, 10 tags/entry, 50 entry IDs per membership request. SQL enforces the account limit in the insert statement and per-entry limits inside an atomic batch; retries of an existing membership remain idempotent at the limit. `/api/tags` uses the same verified session, origin/JSON, expected-account, no-store and ownership boundaries as dictionary/review. Creation, rename, deletion, bulk tagging and per-entry add/remove are Free. Dictionary combines deck/tag filters and exact-term lookup; a compact disclosure holds management controls. Word capture remains click/select → meaning → Save, with no required metadata form.

### Completion and export

`LessonCompletionSummary` composes the existing ShadowingCompletion, selected saved-word enrollment, topic vocabulary, comprehension quiz and difficulty panel. It shows sections, saved/enrolled words, used match scores, completed quiz results and one set of next actions. Quiz state and the existing player stay mounted during evidence replay. Cached result reads never generate a quiz. At most three revisit sections come from the lowest latest stored match attempt, completed incorrect quiz evidence and bookmarks, with explicit reasons and transcript checks. Replay/reveal counts are deliberately unnecessary here; no telemetry or AI weakness score is added.

Completion is immediate. The prior automatic Shadowing Match AI summary now requires **Summarise Shadowing Match**. The deterministic match result and any already-computed summary appear immediately. Existing difficulty analysis at practice opening is preserved; finishing does not remount it or start new inference. Topic vocabulary retains its deterministic local implementation and existing Pro gate. Quiz/translation/grammar/transcription are never requested just because completion occurred. Both cached and uncached completion paths have browser assertions around this boundary.

Exports explicitly choose selected records, the complete current filtered set, or the entire dictionary. Filtered/all export traverses server pages and rejects failures rather than downloading a partial first page. Selected export can use loaded material offline. CSV and Anki-friendly plain TSV share `VocabularyExportRow`: term, reading, gloss/translation, source sentence/translation, lesson, safe source, timestamps, decks and tags. Formula-injection protection remains, including tag/deck names; TSV flattens embedded tabs/newlines. Playback URLs, access hashes, credentials and recordings remain excluded. Concurrent captures/edits during traversal follow the live keyset contract; export is not a historical snapshot.

### Deferred optional interoperability

AnkiConnect/APKG is the next optional interoperability slice and can consume `VocabularyExportRow`; no Anki dependency is added. Inline review playback could reuse the existing practice evidence-replay controller only within the same mounted player, with an explicit return destination and revision check. It requires separate timing/YouTube/local reattachment/Studio verification; this slice retains new-tab source playback.

Offline new-word capture remains deferred. It needs a reviewed contract for temporary IDs and canonical upsert identity, account namespaces, explicit private-context consent, safe source locators, update/deletion conflicts and dependency-ordered sync before deck/tag/review operations can reference the canonical ID. The present account-backed save is preserved.

### Next stage: Phase B — adaptive immersion

Begin with richer dictionary data, then persistent word knowledge states, Word Browser/bulk status, personal comprehension, and high-value/one-unknown-word sentence recommendations. Stable entries, exact-ID/lesson queries, metadata tags and the export seam are ready for those concerns; no Phase-B scheduling, knowledge model or recommendation is implemented here.

### Phase A.2 verification

Local Node 24.21.0 verification passed 216 unit/integration tests, typecheck, lint, both production builds, real local D1 migrations and the built Worker/D1 check. The full 68-test browser suite passed on Next production and isolated vinext/Worker production. The final account-switch UI guard passed the focused 14-test account/retention suite on both runtimes. Deterministic browser regressions additionally cover filtering before deck membership acknowledgment and edits queued during review snapshot hydration; the PR records the expanded 70-test exact-head CI counts before merge. Real D1 fixtures upgrade a populated 0007 database, traverse 650 entries, reach an older word through ID/lesson/export paths, enforce atomic tag limits and bulk 50, and reject forged ownership directly through composite foreign keys. The migrated local ledger includes 0008 and `foreign_key_check` is empty.

Changed code passes formatting; the repository-wide check reports 21 unchanged baseline files outside this diff. The PR records canonical production commit/version, migration/FK audit and a small Free/Pro smoke after merge. Neither local nor live completion verification needs AI generation.

## PR #31 foundation (historical)

Status: the first coherent P0 foundation is implemented. This closes capture → selected recap handoff → short contextual review → deterministic scheduling, while retaining the existing player, dictionary IDs and account boundary. The linked PR records exact-head CI and canonical deployment evidence.

Plan based on main (6 October 2026): extend `dictionary` stable account-owned entries; add many-to-many `decks` and entry-referenced `review` state. Preserve the account request boundary, origin checks and native D1 injection in both runtimes. Add migration 0007 without modifying historical SQL.

1. Pure versioned SM-2-style scheduler with Again/Hard/Good/Easy, minute relearning, UTC elapsed-day intervals, revision-based concurrent grading and deterministic tests.
2. Inbox and named decks; dictionary filtering, explicit enrollment, bulk membership and CSV export. Saving alone never enrolls a card.
3. Account-scoped local review cache and durable operation outbox; retry on reconnect/focus, authoritative D1 scheduling, visible conflict handling. Vocabulary keeps the existing explicit account-save/privacy contract.
4. Short Daily Review sessions (up to 20 cards), meaning reveal, exact existing section links and completion summary. Recap selects saved lesson vocabulary for review alongside existing topic, match and quiz surfaces.
5. Free dictionary/decks/basic review/export; existing variable-cost Pro gates and topic-vocabulary gate remain. This intentionally replaces the earlier Pro-only dictionary policy to follow the competitive roadmap.
6. Verify scheduler, D1 migrations/repositories/ownership/concurrency, browser journey and playback regression on both runtimes; exact PR-head CI before merge; canonical main deployment and migration ledger verification.

Foundation deferrals addressed by A.2: tags, combined recap and dictionary scale. Optional Anki integration, auto-return inline playback, offline new-word capture and Phase B–D remain outside Phase A.

## Contract and deliberate scope choices

- Dictionary entries remain the authoritative word/context records. Saves are still explicit account-backed writes, with a per-account browser cache for offline reviews. Creating new vocabulary requires a connection, matching the existing dictionary architecture. Review and deck edits are immediate local writes with a durable ordered outbox.
- `user_decks` and `user_deck_entries` provide many-to-many collections; `user_review_states` references `(user_id, entry_id)` and never duplicates transcript text. Deleting decks preserves vocabulary/schedules. Deleting vocabulary/accounts cascades. Inbox is protected, and enrollment never occurs automatically.
- Algorithm/schema identity is `sm2-v1`/1. Again relearns in 10 minutes; new Hard/Good cards return in 1 elapsed day and Easy in 4. Good repetitions graduate through 1/6/ease-scaled intervals. Hard grows at 1.2× and reduces ease; Easy grows faster. Ease floors at 1.3. Overdue reviews get no hidden bonus. Intervals use elapsed UTC days and cap at 100 years. Server grades run the same pure scheduler, with revision compare-and-set and a unique operation ID for safe lost-response retries.
- Browser review/deck operations use the existing account namespace and expected-account header; Web Locks serialize outbox drains between supported tabs. Retry occurs on reconnect/focus/hydration, visible minute ticks, next edit, and Retry sync. A stale grading revision restores the server schedule and shows a conflict; it never silently overwrites another device.
- Review sessions take at most 20 currently due words. Again returns on a later short session. Play in context opens the existing player in another tab with section ID and transcript hash. A changed transcript gets a reattachment message instead of replaying a different revision. Private/local sources still require their original device content or reattachment. Export includes no signed direct URLs, credentials or Vimeo access hashes.
- The recap uses saved words from the matching lesson revision and sits alongside existing topic vocabulary, match summary and quiz output. Topic lookup keeps readings when available; saving a topic word makes it selectable in the recap. Basic dictionary/review/decks/export become Free intentionally; all existing AI and topic-vocabulary gates remain.

## Next recommended slice

After A.2 production verification, begin Phase B in the ordering above. Optional AnkiConnect/APKG and offline capture are independent future contracts, not blockers for adaptive immersion.

## Verification

On 6 October 2026, all 195 unit/integration tests passed under Node 24.21.0, as did typecheck, lint, Next production build, vinext production build, local migration application/listing, and the built Worker/D1 check. The real Miniflare tests cover migration of existing vocabulary, Free users without entitlement rows, ownership isolation, foreign keys, deletion, idempotent retries, and simultaneous grade conflicts. Scheduler coverage includes new cards, all grades, repeated reviews, lapses, overdue cards, determinism, DST/leap/year boundaries, ease floors and interval bounds.

The complete Playwright suite runs on both production runtimes. Added stories cover Free/Pro capture, explicit enrollment, due count, reveal, all grades, next card/completion, matching and changed source revisions, separate devices, deck filtering/removal, CSV downloads, selected recap handoff, offline reconnect, stale account cookies and competing grades. Existing playback, offsets, Studio, YouTube/Vimeo/local media, recording, quiz and mobile regression tests remain in the full suite. Final browser counts and deployment evidence belong in the PR, not a claim inferred from test presence.

Changed code passes formatting. The repository-wide formatting check reports 22 unchanged files from `main`; `git diff --quiet` confirmed those paths are outside this change.
