# Personal vocabulary dashboard and imported collections

Vocabulary includes `/vocabulary` (overview), `/review` and `/words`. Shadowing remains the main learning experience. The existing daily practice goal and weekly report remain on Profile, linked from the overview.

## Imported Anki words

Hibiki no longer has an in-app Anki importer (removed November 2026: its daily limit made large decks impractical). Words imported earlier, and words inserted manually by an operator, keep working through the model below. Nothing imports Anki review events or FSRS parameters.

Migration `0019` adds `import_source` to saved entries, plus `user_vocabulary_collections`, `user_vocabulary_memberships`, `user_vocabulary_import_keys` and `user_vocabulary_import_usage`. The last two are no longer written; they stay in D1 and in account export. A collection is one Anki deck: its ID is the SHA-256 hex of the full `parent::child` name, and a collection filter selects an exact deck. A saved context can belong to several collections.

`DictionarySource.kind === 'anki'` (stored as `import_source` JSON `{ kind, collection, contentKey }`) identifies imported text. Its non-null legacy locator columns hold an empty lesson ID and transcript key, zero timing, `lesson_author` `Anki`, `media_type` `local` and the content key in `segment_id` (to satisfy the uniqueness constraint): they mean **absent**, never fabricated lessons. Words, Review, details, replay helpers and exports branch on the source kind; no lesson restore or player request is made for imported text, and exported timestamps and source URLs are empty.

Memberships copy the entry's immutable creation timestamp, indexed on account, collection, timestamp and entry ID, so a 100-context collection page reads about 200 rows without sorting the collection. Account export includes import sources, collection metadata, memberships, import identities and quota records even after downgrade. Deleting a saved word removes its memberships; account deletion cascades through all of these tables.

### Manual insert

To add words for an account outside the app, write per word, in one batch: the entry (only if the account has no entry with that `normalized_term`), a membership per deck, a `user_word_knowledge` upsert, and for Known words the review card change that **Mark known** makes (`status='suspended'`, `revision=revision+1`, new `updated_at`). Set `synced_at` on knowledge rows so devices pull them incrementally. Never overwrite an explicit `ignored` state. D1 counts a batch as one query, and about 3,600 Known words cost about 34,000 rows written, a third of the Free daily allowance shared by all learners: check the day's usage first.

## Dashboard accuracy

The overview initially loads 100 dictionary contexts and 100 collection names, with explicit further pages. Offline vocabulary is labeled as device cache (normally at most 700 entries / 3 MB); collection reads require connectivity. Learning/Known totals describe unique words in loaded contexts, not account-wide or lifetime totals. The existing review/knowledge channels supply schedules and states. Up to 120 actionable history/difficulty contexts are hydrated in groups of 50. Unavailable material is labeled; its ratings remain counted. No persisted dashboard metrics are introduced.

Review events are deduplicated by operation ID; pending undo is respected. Ordinary server sync supplies seven days; a device can retain older events, capped at 10,000. The available range is labeled. Missing activity does not prove no practice occurred. Historical Known growth, review duration, interval changes and Anki activity are not invented. Revisit ordering uses lapse counts plus Again/Hard evidence in the available last seven days, with reasons and a limited-evidence label. It is not an FSRS score. The 14-day schedule is current due dates, not a workload or recall prediction.

Select up to 20 words from today's review, revisit evidence, a kanji, a lesson or a collection for temporary reveal/next practice. Original Hibiki sentence audio is available where authorized; imported words use text. This session writes no grades/history, preserving normal Review's scheduling, event, undo and sync semantics. A text prompt can be copied.

## Ownership and checks

- Dashboard calculations: `src/lib/vocabulary-dashboard.ts`; UI: `src/components/vocabulary-dashboard.tsx`.
- Collections and imported sources: `src/lib/dictionary/repository.ts`, `src/lib/dictionary/replay.ts`, `src/lib/export/vocabulary.ts`; the collections list is `GET /api/vocabulary/collections` in `src/lib/sync/server.ts`, a Pro route in `src/lib/access.ts`.
- Focused checks: `tests/imported-collections.test.ts`, `tests/vocabulary-dashboard.test.ts`, `tests/e2e/vocabulary-dashboard.spec.ts`; normal project checks also apply.
