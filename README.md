# Hibiki — Japanese shadowing practice

Hibiki turns Japanese video into speaking practice: **listen to a short section → pause → say it back → compare → continue**. Paste a YouTube link and its Japanese captions load automatically. You can also bring your own subtitles or media, or generate subtitles with Whisper. With the **Hibiki Bridge** extension, videos on other sites work too.

[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) is the product and engineering source of truth; [docs/architecture.md](docs/architecture.md) maps the code.

## Quick start

Use Node.js **24.x** and npm.

```sh
npm ci
npm run dev        # http://localhost:3000, the Cloudflare Worker with local bindings
```

Choose **Try the demo**, paste a Japanese video link, or choose **Import media or subtitles**. On Windows PowerShell with script execution restricted, use `npm.cmd` / `npx.cmd`.

No secrets are needed for the demo, subtitle import or local caption retrieval. [.env.example](.env.example) lists the production settings (caption relay, DeepL, auth email, YouTube Data API).

## Using Hibiki

| Section | What's there |
| --- | --- |
| **Home** (`/`) | Start from a link or import; Continue watching; **Discover** (a Japanese YouTube catalogue by level and topic) and **Library** (your lessons and Watch later) tabs |
| **Vocabulary** (`/review`, `/words`) | Daily review of saved words, and your word list with search, status and CSV / Anki export |
| **Profile** (`/profile`) | This week, a daily goal, moments to revisit, recent lessons, account and plan |
| **Practice** (`/practice/…`) | The player |

**In the player:**

- **Presets.** Focus, Support and Drill pause after each section; Continuous plays through with a following transcript.
- **Playback.** Speeds 0.5–1.5×, a subtitle timing offset (±50 ms and ±0.5 s), bookmarks, transcript search and translation on request.
- **Studio Mode.** A wide, video-first layout, with optional subtitles over the video.
- **Furigana.** Generated locally in a browser worker.
- **Recording.** Recordings stay in the browser, with A/B listening and local diagnostics.
- **Pro features.** Comprehension checks with evidence replay, topic vocabulary, Shadowing Match and Whisper subtitles.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| R | Replay the section |
| Enter | Continue |
| ← / → | Previous / next section |
| T | Reveal / hide translation |
| M | Start / stop recording |
| P | Play your attempt |
| ? | Shortcuts and help |

Shortcuts leave typing fields and dialogs alone.

**Vocabulary** has one model ([details](docs/vocabulary.md)):

- Tap a word in the sentence and choose **Add to review**, **Known** or **Ignore**.
- Saved words keep their sentence and audio.
- A card that reaches a 21-day interval counts as Known.

## Media and subtitles

- **YouTube.** Japanese captions arrive through an authenticated relay, with a direct fallback. Human tracks are preferred. Auto-generated captions are labelled and offer **Improve with Whisper**.
- **Vimeo and direct audio/video links** play with your subtitles.
- **Your own media** (up to 1 GB) stays in the browser. After a reload, reattach the file; the transcript and position are kept.
- **Other sites.** [Hibiki Bridge](docs/browser-extension.md), a Chrome extension, plays the page's own video for Hibiki. It uses the page's Japanese subtitles, yours, or Whisper subtitles made while the video plays.
- **Subtitle formats.** SRT, WebVTT, ASS, SSA, JSON, or timestamped text, up to 2 MB and 15,000 cues. JSON is an array (or `{ "segments": [...] }`) of `{ "start", "end", "japanese" | "text", "translation"? }` in seconds. [public/demo.vtt](public/demo.vtt) is an example.
- **Whisper subtitles (Pro).** A browser worker cuts local media into 116-second mono windows that overlap by 4 seconds. Each window goes to Workers AI Whisper. The windows are merged by matching text, so a sentence cut at a window edge is kept once and in full. Up to four hours, with progress, cancel and resume.

Segmentation groups captions into sentences or clauses of roughly 2–8 seconds. Splits inside a caption use proportional timing estimates.

## Accounts, storage and privacy

- Practice works without an account and is saved in the browser (`hibiki:v1:*`).
- Optional accounts (Better Auth: verified email or Google) sync progress, preferences, saved words, review, word statuses and Watch later to D1. Every change saves locally first, and sync runs silently in the background.
- After signing in, Hibiki asks once before importing this device's anonymous progress.
- Recordings never leave the browser. Media files are never uploaded.
- Whisper receives only audio windows. Translation sends only the revealed section, plus one neighbour on each side as context.
- [Accounts and sync](docs/accounts-and-sync.md) and [storage](docs/storage.md) have the details.

## Development

```sh
npm run lint
npm run typecheck
npm test                 # unit tests (tsx --test)
npm run build            # Worker build, including Furigana and audio worker bundles
npm run test:d1:runtime  # built Worker + D1 integration
npm run start:test       # preview without remote bindings on :3001
npm run test:e2e         # Playwright against :3001
```

Run `npx playwright install chromium` once. `PLAYWRIGHT_BASE_URL` selects another running app; `PLAYWRIGHT_CHROME_PATH` selects a Chrome executable. Browser tests use mocked providers and the authored demo.

`npm run demo:generate` rebuilds the bundled demo (Edge TTS, FFmpeg, Sharp; needs network). [scripts/check-integrations.mjs](scripts/check-integrations.mjs) and [scripts/check-youtube-browser.mjs](scripts/check-youtube-browser.mjs) exercise the real caption and translation providers against a running app.

## Deployment

Cloudflare Workers via vinext, configured in `cloudflare.config.ts`:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (applies D1 migrations, then deploys the prebuilt Worker) |
| Node.js | 24.x |

Use the pinned `cf` CLI from `npm ci`: beta.14 fixes false custom-domain conflicts during
strict deployments. `hibikiapp.net` serves production traffic only; keep custom-domain
previews disabled in the dashboard. `workersDev` and `previewUrls` remain enabled for
legacy links and workers.dev previews.

The caption relay is a separate Worker plus an outbound Node relay; see [production captions](docs/production-captions.md). Discover needs a server-only YouTube Data API key; see [Discover](docs/discover.md).

## Limitations

- Practice tools, not pronunciation scoring.
- Free caption and translation services can fail; imports and the demo keep Hibiki usable.
- YouTube boundary timing is less precise than direct media.
- DRM-protected sites cannot be transcribed through Hibiki Bridge.
