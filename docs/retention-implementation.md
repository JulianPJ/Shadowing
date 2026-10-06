# Phase A retention implementation

Status: the first coherent P0 foundation is implemented. This closes capture → selected recap handoff → short contextual review → deterministic scheduling, while retaining the existing player, dictionary IDs and account boundary. The linked PR records exact-head CI and canonical deployment evidence.

Plan based on main (6 October 2026): extend `dictionary` stable account-owned entries; add many-to-many `decks` and entry-referenced `review` state. Preserve the account request boundary, origin checks and native D1 injection in both runtimes. Add migration 0007 without modifying historical SQL.

1. Pure versioned SM-2-style scheduler with Again/Hard/Good/Easy, minute relearning, UTC elapsed-day intervals, revision-based concurrent grading and deterministic tests.
2. Inbox and named decks; dictionary filtering, explicit enrollment, bulk membership and CSV export. Saving alone never enrolls a card.
3. Account-scoped local review cache and durable operation outbox; retry on reconnect/focus, authoritative D1 scheduling, visible conflict handling. Vocabulary keeps the existing explicit account-save/privacy contract.
4. Short Daily Review sessions (up to 20 cards), meaning reveal, exact existing section links and completion summary. Recap selects saved lesson vocabulary for review alongside existing topic, match and quiz surfaces.
5. Free dictionary/decks/basic review/export; existing variable-cost Pro gates and topic-vocabulary gate remain. This intentionally replaces the earlier Pro-only dictionary policy to follow the competitive roadmap.
6. Verify scheduler, D1 migrations/repositories/ownership/concurrency, browser journey and playback regression on both runtimes; exact PR-head CI before merge; canonical main deployment and migration ledger verification.

Deferred: optional tags, deep Anki integration, auto-return inline review playback, richer combined recap diagnostics and all Phase B–D features.

## Contract and deliberate scope choices

- Dictionary entries remain the authoritative word/context records. Saves are still explicit account-backed writes, with a per-account browser cache for offline reviews. Creating new vocabulary requires a connection, matching the existing dictionary architecture. Review and deck edits are immediate local writes with a durable ordered outbox.
- `user_decks` and `user_deck_entries` provide many-to-many collections; `user_review_states` references `(user_id, entry_id)` and never duplicates transcript text. Deleting decks preserves vocabulary/schedules. Deleting vocabulary/accounts cascades. Inbox is protected, and enrollment never occurs automatically.
- Algorithm/schema identity is `sm2-v1`/1. Again relearns in 10 minutes; new Hard/Good cards return in 1 elapsed day and Easy in 4. Good repetitions graduate through 1/6/ease-scaled intervals. Hard grows at 1.2× and reduces ease; Easy grows faster. Ease floors at 1.3. Overdue reviews get no hidden bonus. Intervals use elapsed UTC days and cap at 100 years. Server grades run the same pure scheduler, with revision compare-and-set and a unique operation ID for safe lost-response retries.
- Browser review/deck operations use the existing account namespace and expected-account header; Web Locks serialize outbox drains between supported tabs. Retry occurs on reconnect/focus/hydration, visible minute ticks, next edit, and Retry sync. A stale grading revision restores the server schedule and shows a conflict; it never silently overwrites another device.
- Review sessions take at most 20 currently due words. Again returns on a later short session. Play in context opens the existing player in another tab with section ID and transcript hash. A changed transcript gets a reattachment message instead of replaying a different revision. Private/local sources still require their original device content or reattachment. Export includes no signed direct URLs, credentials or Vimeo access hashes.
- The recap uses saved words from the matching lesson revision and sits alongside existing topic vocabulary, match summary and quiz output. Topic lookup keeps readings when available; saving a topic word makes it selectable in the recap. Basic dictionary/review/decks/export become Free intentionally; all existing AI and topic-vocabulary gates remain.

## Next recommended slice

Polish the existing recap into one compact summary of already-computed match, quiz and attention-section signals; evaluate lightweight tags and dictionary cache/pagination limits before growing collections. Extend explicit capture to offline new-word saves only with a reviewed conflict/privacy contract. AnkiConnect/APKG can consume the existing `VocabularyExportRow` layer. Do not begin Phase B–D before the retention foundation is verified in production.

## Verification

On 6 October 2026, all 195 unit/integration tests passed under Node 24.21.0, as did typecheck, lint, Next production build, vinext production build, local migration application/listing, and the built Worker/D1 check. The real Miniflare tests cover migration of existing vocabulary, Free users without entitlement rows, ownership isolation, foreign keys, deletion, idempotent retries, and simultaneous grade conflicts. Scheduler coverage includes new cards, all grades, repeated reviews, lapses, overdue cards, determinism, DST/leap/year boundaries, ease floors and interval bounds.

The complete Playwright suite runs on both production runtimes. Added stories cover Free/Pro capture, explicit enrollment, due count, reveal, all grades, next card/completion, matching and changed source revisions, separate devices, deck filtering/removal, CSV downloads, selected recap handoff, offline reconnect, stale account cookies and competing grades. Existing playback, offsets, Studio, YouTube/Vimeo/local media, recording, quiz and mobile regression tests remain in the full suite. Final browser counts and deployment evidence belong in the PR, not a claim inferred from test presence.

Changed code passes formatting. The repository-wide formatting check reports 22 unchanged files from `main`; `git diff --quiet` confirmed those paths are outside this change.
