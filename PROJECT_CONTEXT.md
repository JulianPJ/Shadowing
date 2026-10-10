# Project context — Hibiki

Persistent product and engineering context. Keep it short and current; history lives in git.

## Purpose

Hibiki is a Japanese listening and speaking app built around **shadowing**: listen to a short
section of authentic media, pause, say it back, compare, continue. It removes the mechanics that
make shadowing tedious (seeking, pausing, remembering the line) so learners can practise with
content they actually want to watch. The long-term loop is
**consume → shadow → understand → review → retain**, connected to the original sentence, timestamp
and audio.

## Principles

- **Shadowing stays central.** Vocabulary, quizzes and progress support the listen/pause/repeat
  loop; they never displace it.
- **Japanese first, translation on request.** Japanese is always visible; English is revealed.
- **Authentic content.** Learners bring their own media; YouTube is the first source, not the limit.
- **Context is the moat.** Words, quizzes and review link back to the exact sentence and audio.
- **Useful feedback over fake precision.** No authoritative pronunciation scores from crude signals.
- **Graceful fallback.** Imported subtitles, own media and the bundled demo keep the app usable when
  a provider fails.
- **Proportionate infrastructure and a calm UI.** One runtime, short copy, no sync status unless the
  learner must act (an expired session).

## Information architecture

| Section | Routes | Contents |
| --- | --- | --- |
| Home | `/`, `/discover`, `/library`, `/prepare` | Paste a link or import; Continue watching; tabs **Discover** (catalogue feed) and **Library** (lessons + Watch later) |
| Vocabulary | `/review`, `/words` (`/dictionary` alias) | Tabs **Review** (daily SRS) and **Words** (saved words + other marked words) |
| Profile | `/profile` (`/progress`, `/account` aliases) | This week + daily goal, summary, moments to revisit, recent lessons, account and plan |
| Practice | `/practice/[id]` | The player |

## Current implementation

- **Player:** presets Focus / Support / Drill / Continuous (the preset determines Shadowing vs
  Continuous mode), automatic section pause, replay, previous/next, speed 0.5–1.5×, subtitle offset
  (±50 ms and ±0.5 s), lazy DeepL translation, bookmarks, transcript search, Studio Mode with an
  optional subtitle overlay on the video, Furigana (local kuromoji worker), recording with A/B listening, hands-free drill, local recording
  diagnostics and Pro Shadowing Match. Shortcuts: Space, R, Enter, ←/→, T, M (record/stop),
  P (play attempt), ? (help). Playback time lives in an external store so ticks re-render only the
  section progress bar.
- **Sources:** YouTube Japanese captions (authenticated relay, direct fallback; auto-generated
  tracks are labelled and offer "Improve with Whisper"), Vimeo and direct links with a user
  transcript, local media + SRT / VTT / ASS / SSA / JSON / timed TXT, Pro Whisper subtitles for
  local media (Workers AI; 116 s windows overlapping by 4 s, merged by matching text), videos on
  other sites through the **Hibiki Bridge** Chrome extension ([details](docs/browser-extension.md)),
  and the bundled demo.
- **Learning:** Pro comprehension checks with evidence replay, content difficulty estimates, local
  learner profile, weekly report and daily goal, Discover catalogue with Watch later.
- **Vocabulary:** one model — see [vocabulary](docs/vocabulary.md). Look up a word in the sentence,
  **Add to review** (saved word + review card + Learning), or mark **Known** / **Ignore**. Review
  intervals of 21+ days count as Known; a lapse returns the word to Learning. No decks or tags.
- **Accounts:** Better Auth (email with verification, Google linking). Anonymous use is
  local-first; signing in offers a one-time import of device progress.

## Architecture

- **One runtime:** a Cloudflare Worker built with vinext (`npm run dev`, `npm run build`,
  `npm run start:test`). API routes are ordinary route handlers in `src/app/api` that read bindings
  from `cloudflare:workers` through [`src/lib/server/runtime.ts`](src/lib/server/runtime.ts); every
  API route exports `dynamic = 'force-dynamic'` so the framework response cache never sees it.
  [`cloudflare-worker.js`](cloudflare-worker.js) only adds `/demo.mp4` byte ranges, the Discover
  kill switch and the 15-minute catalogue cron.
- **Rate limits:** keyed by a constant route name and client IP. `SHADOWING_AI_RATE_LIMIT`
  (6/min, fails closed) for Workers AI routes (transcribe, difficulty, quiz, shadowing); `PUBLIC_API_RATE_LIMIT` (60/min, fails open) for translation and caption preparation;
  `DISCOVERY_RATE_LIMIT` (90/min) for Discover and Watch later.
- **D1:** shared transcripts and generated artifacts (trusted, hash-verified), accounts, learner
  sync, saved words, review schedules and rating events, word states, Discover catalogue.
  Migrations are additive; unused tables from removed features are left in place.
- **Browser storage:** `hibiki:v1:*` localStorage keys, namespaced per account. Each transcript is
  stored once under `lesson:{id}`; recent history stores references; section moves write only
  `position:{id}`.
- **Sync:** the learner snapshot (`src/lib/sync`) plus three channels on one engine
  (`src/lib/sync/channel.ts`): review operations, word states (incremental by server `synced_at`)
  and Watch later / Discover preferences. Routine triggers reuse a sync from the last 5 minutes
  unless there are local edits; signed-out and unverified accounts never sync.
- **Hibiki Bridge:** a Manifest V3 extension (`extension/`) that plays a page's own `<video>` for
  Hibiki, reads its subtitle tracks, mirrors the current line over it, and captures its audio for
  Whisper. It acts only on tabs the learner connects from the popup.

See [architecture](docs/architecture.md) for module ownership and checks.

## Roadmap

1. Post-video comprehension checks — done.
2. Content difficulty analysis — done.
3. Progress and learner modelling — done.
4. Polish / monetisation — in progress. Done: navigation and vocabulary simplification, single
   runtime, rate limits, one sync engine. Remaining: analytics, sensible Free/Pro limits,
   subscriptions.
5. Broaden content sources — Hibiki Bridge v1 done (Chrome). Chrome Web Store release packaging prepared; developer-account submission pending. Next:
   Firefox, `chrome.tabCapture` for sites that block element capture, and using the extension to
   capture YouTube audio for "Improve with Whisper".
6. End-of-video transcript intelligence (level-appropriate grammar and key vocabulary).
7. Weak-section review built from replays, reveals, bookmarks and missed questions.
8. Personalised difficulty / adaptive practice.
9. Pronunciation feedback beyond the current local diagnostics and Shadowing Match.
10. Vocabulary — core loop done (save → review → Known); next is reviewing words in their audio
    clip by default.
11. AI conversation about the video — deliberately last.

## Known constraints

- DeepL translation and Workers AI are best-effort; failures never block shadowing.
- YouTube boundary timing is less precise than direct media; the player polls every 35 ms and pauses
  hidden-tab shadowing.
- Local media object URLs do not survive a reload; the transcript persists and the media can be
  reattached.
- Whisper subtitles need the media file, or Hibiki Bridge listening along in real time. DRM-protected
  and capture-blocking sites cannot be transcribed.
- Hibiki Bridge lessons need the original page open; saved words from them replay through the
  Hibiki lesson only.
- Caption relay operations: [production captions](docs/production-captions.md).
