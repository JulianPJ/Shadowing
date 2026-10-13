# Free and Pro access

Hibiki Free is **Watch & Understand**; Hibiki Pro is **Practice & Improve**. The
policy lives in `src/lib/access.ts`, with `useProAccess` for browser controls and
authenticated guards for server operations. Account plans come from the existing
Paddle expiry projection, keeping sandbox/live separation and manual/test grants.

| Capability                                                                                              | Free (including anonymous where supported)           | Pro |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --- |
| Discover, recommended videos, search and JLPT/basic filters                                             | Yes                                                  | Yes |
| Watch Later, library, recently opened lessons                                                           | Yes; account Watch Later/viewer sync stays available | Yes |
| Supported links and local media, provider Japanese captions, own subtitle uploads/paste                 | Yes, without new usage limits                        | Yes |
| Player/transcript, dictionary definitions/readings, furigana, speed, seeking, segment navigation/replay | Yes                                                  | Yes |
| Focus/manual repetition, Continuous, Studio Mode and display/timing settings                            | Yes                                                  | Yes |
| Subtitle-supplied translations                                                                          | Yes                                                  | Yes |
| On-demand provider translations and detailed difficulty analysis                                        | Locked                                               | Yes |
| Automatic subtitles, Shadowing Match, quizzes/review, essential vocabulary                              | Locked (existing Pro allocation)                     | Yes |
| Microphone recording, recorded playback, local diagnostics                                              | Locked                                               | Yes |
| Support/Drill, repeated-play automation, timed windows, hands-free practice                             | Locked                                               | Yes |
| Saved words/sentences, word states, management, SRS and Anki/CSV export                                 | Locked                                               | Yes |
| Personal vocabulary coverage/recommendations, detailed progress, weekly reports and daily goals         | Locked                                               | Yes |
| Learning-data synchronization                                                                           | Locked                                               | Yes |
| Authentication, subscription management, personal-data download                                         | Yes for accounts                                     | Yes |

## Boundaries and data lifecycle

- `/api/translate` and `/api/difficulty` reject unauthenticated/Free requests
  before provider creation, inference, rate budgets or shared artifact reads.
  Existing subtitle, quiz and Shadowing Match gates remain in place. Discover
  still publicly serves catalogue difficulty estimates and basic recommendations.
- `/api/dictionary` stores personal vocabulary (the public lexical lookup is
  browser-local). It and `/api/review` and `/api/knowledge` reject paid reads and
  mutations for Free before consulting their learning repositories.
- `/api/sync/bootstrap` and `/api/sync/push` retain Free viewer preferences and
  lesson positions; paid collections and review limits cannot be uploaded by a
  Free browser. Free pulls skip learning tables. Public lesson restoration stays
  usable. Watch Later/Discover channels retain their existing authorization,
  validation, quotas and independent shared sync engine.
- Stored paid browser settings cannot start advanced automation on Free. Locked
  recording trees unmount and release microphones on access loss; local progress
  tracking and vocabulary-derived analysis require Pro. Upgrade notices reuse the
  existing components and links without opening dialogs during playback.
- Downgrading deletes no records. Free hydration leaves local learning data in
  place, and position writes retain the repository's monotonic completion merge.
  Resubscribing forces a fresh learner sync and restores paid controls/data.
- Account's **Download personal data** is available on both plans. It combines
  a session-owned raw JSON export from `/api/account/export` with current device
  data; it does not provide paid review, analysis or Anki/CSV workflows. Recordings
  keep their existing in-memory player lifetime and are never uploaded by sync.

## Billing and verification

Price display still comes from Paddle's configured monthly/annual prices. The
intended £3.99 monthly catalogue change is separate: this refactor changes no
price IDs, amounts, secrets, live activation, checkout/webhooks or portal behavior.

`tests/paywall.test.ts`, the native D1 account lifecycle tests, the built Worker
runtime check and `tests/e2e/paywall.spec.ts` cover direct requests, Free imports,
dictionary lookup, stored-state bypass attempts, downgrade preservation and access
restoration. Learning regressions use explicit Pro fixtures. AI and Paddle are
mocked; the relevant existing playback, Discover, sync and billing tests remain.
