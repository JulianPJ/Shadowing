# Vocabulary

Hibiki has one vocabulary model. Every word has a **status**, and every saved word also has a **review card** tied to the sentence and audio it came from.

| Status | Meaning | How a word gets it |
| --- | --- | --- |
| Unknown | Not marked yet | Default |
| Learning | Being reviewed | **Add to review**, **Learn again**, or forgetting a mature card |
| Known | Retired from review | **Mark known**, or a card reaching a 21-day interval |
| Ignored | Never highlight or count it | **Ignore** |

## Where learners meet it

- **Lookup panel** (practice): definitions for the tapped word, then one primary action: **Add to review**, or **In review** / **Learn again** once saved. **Known** and **Ignore** are toggles, and an "Edit before saving" section holds meaning, reading and sentence translation.
- **Vocabulary → Review** (`/review`): today's due cards, graded Again / Hard / Good / Easy, with the source sentence and an "Open full lesson" link. One "New words per day" and one "Reviews per day" limit live under "Review settings".
- **Vocabulary → Words** (`/words`, alias `/dictionary`): search; filter All / Learning / Known; Mark known / Learn again; delete; CSV or Anki TSV export; other marked words (states without a saved entry).
- **Lesson Vocabulary tab**: share of the lesson's words marked Known, high-value lines and a link to the Words view.

## Rules

Implemented in `src/lib/vocabulary.ts`:

- **Add to review** saves the entry (`src/lib/dictionary`), enrolls a card (`src/lib/review`) and sets Learning (`src/lib/knowledge`).
- **Mark known** suspends the card and sets Known. **Learn again** re-enrolls it and sets Learning.
- **Grading keeps status in step.** A card that reaches `KNOWN_INTERVAL_DAYS` (21) counts as Known; a lapse from review returns a Known word to Learning. Ignored is never overridden.
- Saving words requires a verified account. Statuses work anonymously and stay on the device until the learner accepts the one-time import after signing in.

## Storage and sync

- Saved words: D1 `user_dictionary_entries`, cursor-paged, with an account-scoped browser cache.
- Cards and rating history: D1 `user_review_states` and `user_review_events`, applied locally first through a replayable outbox. A conflicting edit from another device restores the server schedule and shows a one-line notice.
- Statuses: `user_word_knowledge`, last-writer-wins, pulled incrementally by `synced_at`.
- All three sync through the shared channel engine in `src/lib/sync/channel.ts`.
- Decks, tags, the inbox and per-deck limits were removed. Their tables stay in D1 unused. Deck operations still queued in older open tabs are acknowledged as no-ops, and enroll operations that carry a legacy `deckId` still apply.
