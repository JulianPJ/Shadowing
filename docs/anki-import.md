# Personal vocabulary dashboard and Anki import

Vocabulary now includes `/vocabulary` (overview), `/review`, `/words`, and `/vocabulary/import`. Shadowing remains the main learning experience. The existing daily practice goal and weekly report remain on Profile, linked from the overview.

## Local package inspection

Export an Anki Deck Package (`.apkg`), include scheduling information for interval classification, and disable media export: Hibiki imports text and deck structure only.

Modern Anki databases use a custom `unicase` collation, including on `WITHOUT ROWID` field metadata. The browser parser substitutes `BINARY` in the private in-memory metadata table declarations before enabling query-only mode. It scans those tables without secondary indexes and orders fields only by numeric note-type ID and ordinal; it never relies on substituted name comparison rules. Original package bytes, text and Anki data remain unchanged. Regression fixtures include this layout and its name index.

Import is Pro and requires a verified account. It never connects to AnkiWeb or changes Anki. A dedicated browser worker reads ZIP using zip.js, SQLite using sql.js/WASM and modern Zstandard collections using fzstd. It supports package metadata versions 1–3: `collection.anki2`, `collection.anki21`, and `collection.anki21b`, including schema-18 normalized note types, fields and decks. References: [Anki exporting](https://docs.ankiweb.net/manual/exporting), [official package metadata](https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto), [official schema normalization](https://github.com/ankitects/anki/blob/main/rslib/src/storage/upgrades/schema15_upgrade.sql).

The package stays on the device. Checking existing vocabulary and saving send only selected mapped text and deck names. Templates are never evaluated or mounted. Fields become text rendered through React. Audio/image members are not extracted, played or uploaded. Unknown metadata versions, encrypted collections, malformed databases and excessive resource requirements fail recoverably. Limits:

- 128 MiB package; 64 MiB expanded collection, output and Zstandard window.
- 100,000 ZIP entries; 50,000 notes; 200,000 cards.
- 100 note types; 1,000 decks; 100 fields per note type.
- 60-second analysis timeout and cancellation.

Field suggestions cover Japanese Sentences, Refold JP9K/JP1K and Lapis/Yomitan conventions. Learners inspect samples per note type and can map any field. A Japanese expression is required; reading, meaning and both sentence fields are optional. Bracket furigana can supply a whole-word reading. Custom templates, template-generated expressions and per-kanji readings are not interpreted. Unsupported template-derived content needs a usable exported field.

Initial classification is all Known, all Learning, or review interval with an editable positive cutoff (default 21 days). Interval mode requires at least one usable review card. A word becomes Known only if **all selected cards contributing to that word**, across its mapped contexts, have positive review-type intervals at or above the cutoff. New, learning, relearning and missing/invalid intervals result in Learning and are counted in preview. Anki review events and FSRS parameters never become Hibiki history. Newly Learning words start Hibiki's existing scheduler; Known words follow the existing retired-word behavior.

## Additive model and compatibility

Migration `0019` adds `import_source` to saved entries, plus `user_vocabulary_collections`, `user_vocabulary_memberships`, `user_vocabulary_import_keys` and an import-quota table. Removed active-deck tables are not reused: old pending deck operations stay harmless no-ops. Full `parent::child` names retain hierarchy; a collection filter selects an exact deck. A note's selected cards can contribute multiple memberships to one context, up to eight selected decks per context. Empty parent decks have no separate collection row; the hierarchy remains in descendant paths.

`DictionarySource.kind === 'anki'` explicitly identifies imported text, with `collection` and `contentKey`. Existing non-null legacy locator columns contain empty lesson/transcript identifiers and zero timing, meaning **absent**, never fabricated lessons or transcript hashes. The legacy `segment_id` column holds the stable content identity to preserve its uniqueness constraint. Words, Review, details, replay helpers and exports branch on the explicit source kind. No lesson restore or player request is made for Anki text; exported timestamps/source URLs are empty. Lesson sources and wire schema version 1 remain unchanged. Older clients need a refresh to display imported text correctly; existing outbox operations and entry-ID validation remain compatible.

Content identity hashes mapped expression, reading, meaning and both sentence fields, excluding package filename, deck membership, classification choice and Anki card IDs. Exact repeat imports keep saved IDs, learner edits, statuses and schedules. A deleted context gets a fresh entry ID on re-import, preventing an older queued grade from targeting its replacement. Exact existing Hibiki contexts can receive memberships without changing their source. Different contexts for one word are ambiguous: skip by default, or explicitly choose to add distinct contexts. Preview shows up to 20 existing-match examples and effective Known/Learning counts after preserving existing choices. Distinct contexts within the package are also flagged and skipped unless the learner chooses them. Existing lemma-level Known/Learning/Ignored/Unknown states win, including the implied status of legacy entries without a state row. A new distinct context does not create another active schedule when its lemma already has one. A later explicit Learn again remains a learner action.

Memberships copy the entry's immutable creation timestamp, with an index on account, collection, timestamp and entry ID. Collection browsing uses that index before joining dictionary material, so a 100-context page does not sort or traverse the entire collection. Import identities retain the same timestamp for repeat membership writes without another material read.

Imports run in staged batches of at most 500 contexts, with 1,000 new contexts per account per UTC day. Each server request contains at most three contexts and eight memberships, below the Free query ceiling including ordinary auth. Each context's material, import identity, initial state, optional schedule, memberships and quota reservation commit atomically. Acknowledged batches stay saved after interruption; repeat the package to continue safely. No package or resume payload is persisted in browser storage. Duplicate retries remain allowed at the daily quota. Concurrent reservations can conservatively consume extra quota, but cannot exceed it or reset a schedule.

Account export includes import sources, collection metadata, memberships, import identities and quota records even after downgrade. Account deletion cascades through new tables. Deleting a saved word removes its memberships and import identities. No R2 or KV binding is added.

## Dashboard accuracy

The overview initially loads 100 dictionary contexts and 100 collection names, with explicit further pages. Offline vocabulary is labeled as device cache (normally at most 700 entries / 3 MB); collection reads require connectivity. Learning/Known totals describe unique words in loaded contexts, not account-wide or lifetime totals. The existing review/knowledge channels supply schedules and states. Up to 120 actionable history/difficulty contexts are hydrated in groups of 50. Unavailable material is labeled; its ratings remain counted. No persisted dashboard metrics are introduced.

Review events are deduplicated by operation ID; pending undo is respected. Ordinary server sync supplies seven days; a device can retain older events, capped at 10,000. The available range is labeled. Missing activity does not prove no practice occurred. Historical Known growth, review duration, interval changes and Anki activity are not invented. Revisit ordering uses lapse counts plus Again/Hard evidence in the available last seven days, with reasons and a limited-evidence label. It is not an FSRS score. The 14-day schedule is current due dates, not a workload or recall prediction.

Select up to 20 words from today's review, revisit evidence, a kanji, a lesson or a collection for temporary reveal/next practice. Original Hibiki sentence audio is available where authorized; imports use text. This session writes no grades/history, preserving normal Review's scheduling, event, undo and sync semantics. A text prompt can be copied. Hosted generation, saved writing sessions and the optional pasted-text reader are outside this release.

## Measured D1 use

Real local workerd/D1 measurements, including indexes and quota writes:

| Scenario | Rows read | Rows written |
| --- | ---: | ---: |
| 10 new Learning contexts, one shared deck | 89 | 175 |
| Repeat the same 10 | 10 | 0 |
| 500 new Learning contexts, one shared deck | 4,479 | 8,505 |
| Repeat the same 500 | 500 | 0 |
| Initial vocabulary + collection metadata, 500-context account | 102 | 0 |
| First 100-context collection page, 500-context account | 202 | 0 |

These exclude existing auth, review snapshot and knowledge-channel reads. Read counts vary slightly with tree layout and fresh random entry IDs. Review still reads the current account schedule and up to 10,000 recent events; knowledge retains incremental paging. Within their ordinary five-minute reuse window, dashboard visits do not force those channels to repull. The 500-context import uses roughly 8.5% of the shared Free 100,000 writes/day allowance. Per-account quota cannot guarantee remaining database-wide capacity; concurrent learners can still exhaust it. Failed batches can be retried after the UTC reset. Production D1 metrics remain authoritative. Reproduce with `npx tsx --test tests/anki-import.test.ts`; results are written to `artifacts/anki-d1-usage.json`.

## Ownership and checks

- Package, mapping and import domain: `src/lib/anki/`; UI: `src/components/anki-import.tsx`.
- Browser assets: `scripts/prepare-anki.mjs`, called by predev/prebuild, loaded only for import.
- Dashboard calculations: `src/lib/vocabulary-dashboard.ts`; UI: `src/components/vocabulary-dashboard.tsx`.
- Account access/origin/ownership gates: `src/lib/sync/server.ts`, with Pro route allocation in `src/lib/access.ts`.
- Focused checks: `tests/anki-import.test.ts`, `tests/vocabulary-dashboard.test.ts`, `tests/e2e/anki-dashboard.spec.ts`; normal project checks also apply.

Fixtures are synthetic packages built from the supported Anki schema/container layouts, including an Anki-specific `unicase` schema collation. They are not a claim that every community deck or future Anki format is supported. No private learner packages were used.
