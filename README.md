# Hibiki — Japanese shadowing practice

Hibiki is a personal Japanese listening and speaking practice app. It turns timestamped speech into short sections so you can **listen → pause → repeat aloud → replay → continue** at your own pace.

The intention of this repository is to make regular shadowing easy: bring a supported video link or your own media, pair it with Japanese captions or a timed transcript, focus on the sound first, and reveal English only when you need it. It is a working practice prototype with replaceable media, transcription and translation providers. The core app needs no account, database, paid API key, or model download.

## Quick start

Use Node.js **24.x**, as specified in `package.json`, and npm.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and choose **Try the demo**. Alternatively, paste a Japanese video link or choose **Import media or subtitles**. On Windows PowerShell with script execution restricted, use `npm.cmd` and `npx.cmd`.

For a production build:

```sh
npm run build
npm start
```

No environment variables are required for the demo, subtitle import, or local direct caption retrieval. Production automatic captions use the configured authenticated relay with a direct fallback, and production on-demand translation requires the server-only `DEEPL_AUTH_KEY` secret. [.env.example](.env.example) documents the server settings; [production caption operations](docs/production-captions.md) covers deployment and health checks.

## Features and practice flow

1. **Choose a lesson.** Start the bundled demo, prepare a YouTube video with Japanese captions, or pair a supported video link/local audio/video file with a timestamped transcript.
2. **Listen to a section.** Shadowing mode pauses playback at the section boundary and gives you as much time as you need to repeat it.
3. **Repeat and compare.** Replay the source, optionally record your voice, and listen to your attempt before continuing.
4. **Continue or review.** Move between sections, click a transcript row, search for Japanese phrases, or filter to bookmarked sections.

Available functionality:

- Official YouTube embedded playback and browser playback of local media.
- Streamed preparation progress, bounded timeouts, and import fallbacks when captions are unavailable.
- Sentence/clause segmentation using punctuation, caption timing, and pauses; estimated timings are marked when a caption is split.
- **Shadowing** mode with automatic pauses and **Continuous** mode with a following transcript. Switching modes preserves playback position.
- Instant replay, previous/next section, section and lesson progress, and speeds of **0.5×, 0.75×, 1×, and 1.25×**.
- English hidden initially, revealed on demand, and hidden again when moving to another section.
- Searchable timestamped Japanese transcript, section bookmarks, and a saved-sections filter.
- Microphone recording and A/B listening. Starting one playback source pauses the other. Recordings are limited to 60 seconds and cleared when changing sections or leaving the player.
- Locally saved transcripts, last section, mode/speed, bookmarks, cached translations, and current-section translation visibility. The home screen displays the three most recent lessons from a history of up to eight.
- Responsive desktop/mobile layouts, locally served Japanese fonts, keyboard focus styles, modal focus management, and reduced-motion support.
- Optional estimated content difficulty: full-transcript approximate JLPT band, vocabulary, grammar, caption-derived speech pace and conversational complexity, with local reuse. See [classification, Workers AI setup and persistence](docs/content-difficulty.md).

| Shortcut | Action |
| --- | --- |
| Space | Play/pause |
| R | Replay the current section |
| Enter | Continue |
| ← / → | Previous/next section |
| T | Reveal/hide translation |

Shortcuts leave typing fields and open dialogs alone. Focused native buttons retain their normal Space/Enter behavior.

### Bundled demo

**A quiet morning** is an original 14-section beginner script with Japanese synthetic speech, an illustrated landscape video, audio-derived timings, and authored English translations. It runs without YouTube or a translation service. The app labels the voice as synthetic; it is not a human native-speaker recording.

The Cloudflare entrypoint handles byte ranges for the small bundled MP4, including when the asset binding omits `Content-Length`. This preserves replay and section seeking in the deployed demo. The player and own-media import behavior are unchanged.

## Video links and transcript import

Paste a YouTube URL to request existing **Japanese captions**. Production uses the configured caption relay first and retains direct `youtube-transcript-plus` retrieval as a fallback. Both produce the same normalized cues, so segmentation and player behavior stay provider-independent. Video metadata comes from YouTube's official oEmbed endpoint when available, and playback uses the official YouTube IFrame player.

YouTube, Vimeo and direct HTTP(S) audio/video links use normalized playback controls. Vimeo/direct links currently need your transcript; missing Japanese YouTube captions open the same **Video link + transcript** dialog with the resolved link and metadata retained. Caption relay outages and other infrastructure failures remain distinct errors. The app does not download or re-host third-party media.

For other public pages, Hibiki attempts browser-side extraction from media sources, OpenGraph and JSON-LD metadata where CORS permits access. The extracted direct link is exposed for opening and playback. Arbitrary iframes are unsupported; this path cannot bypass authentication, DRM, referrer/embedding restrictions or CORS. Vimeo speed changes depend on creator settings. See [media contracts, migration, extraction limits and future seams](docs/media-sources.md).

### Transcript formats

Import **SRT, WebVTT, ASS, SSA, or JSON**, or paste timestamped transcript text. **TXT** may contain the same timed syntax; untimed prose is rejected. ASS/SSA parse Events Dialogue rows, centisecond timestamps, override tags and line breaks through the same cue validation. Subtitle files may be up to **2 MB**. [public/demo.vtt](public/demo.vtt) is a ready-to-use example.

JSON accepts an array or an object containing a `segments` array:

```json
[
  {
    "start": 0.5,
    "end": 4.2,
    "japanese": "今日はいい天気ですね。",
    "translation": "It's a nice day today."
  }
]
```

Timings are numeric **seconds**, with `end` later than `start`. `text` can replace `japanese`; `offset` and `duration` can replace `start` and `end`. Translations are optional and hidden until revealed. Validation accepts up to 15,000 cues and timestamps up to 24 hours.

Segmentation cleans markup, removes repeated rolling-caption text, trims display overlaps, and groups natural sentences or clauses. Most sections target roughly 2–8 seconds; short greetings and longer unbroken utterances may be preserved. Splits within a caption use proportional timing estimates rather than word alignment. Caption recognition errors and imperfect boundaries remain possible.

### Own audio/video

Choose **Import media or subtitles → Own media**, then select media and Japanese subtitles. Formats depend on the browser's codecs; common candidates include MP4/M4V, WebM, MOV, MP3/M4A/AAC, WAV, OGG/OGA/OGV and FLAC. Selection uses media MIME categories and the browser determines decoding support; unsupported files produce a playback error. Media is limited to **250 MB**.

With subtitle import, media stays in the browser. After a full refresh, the transcript and last section remain saved, but you must reattach the original media file. Browser object URLs survive only the current session.

## Translation, storage, and privacy

Demo translations are authored, and imported translations are used when supplied. In canonical Cloudflare production, other sections request Japanese-to-English translation from **DeepL** only when revealed. The current section is the only billable translation text; Hibiki sends at most one neighboring Japanese section on each side through DeepL's context field to improve disambiguation without translating that context. API Free keys use `api-free.deepl.com`; Pro keys use `api.deepl.com`. Responses are cached in the browser and a bounded in-memory server cache. MyMemory remains a keyless local/non-Cloudflare fallback.

Translation failures show a retryable message and do not prevent playback. The reveal button returns to a usable state after a failure instead of remaining stuck open. Another implementation can replace `TranslationProvider`.

Practice data lives in browser `localStorage`, scoped to the current origin/browser/device. Native Cloudflare D1 stores reusable provider transcripts and trusted transcript-derived quizzes/difficulty as a shared content cache. There are no accounts, hosted learner history, or cross-device learner synchronization. See [storage architecture and migrations](docs/storage.md). Hosted AI subtitle generation remains unimplemented. User transcript imports stay private/browser-local, including those paired with public links. Clearing site storage removes saved practice data. Recordings stay in memory and are neither uploaded nor persisted. YouTube requests and requested automatic translations require network access. Optional Whisper transcription sends selected media directly to the configured local service.

Recording requires a browser with `MediaRecorder`, a microphone, permission, and **HTTPS or localhost**. Denied permission shows a recovery message while playback remains available.

Requesting a difficulty estimate sends only the normalized Japanese transcript through the app API. The decision classifier covers the full transcript, chunking only when the script exceeds the safe per-request budget. Browser-cached estimates stay on this device; estimates derived from matching hosted system transcripts can also be reused through D1. The bundled demo uses authored data.

## Optional local Whisper transcription

This optional Python service transcribes your own media when you have no subtitles. It runs separately from Next.js, uses `faster-whisper` on CPU with int8, Japanese language, and voice activity detection, and downloads an open Whisper model on first use. Python **3.10+** is required.

```sh
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.venv\Scripts\Activate.ps1
```

```sh
# macOS/Linux
source .venv/bin/activate
```

Then install and start the service:

```sh
pip install -r tools/requirements.txt
uvicorn tools.whisper_service:app --host 127.0.0.1 --port 8765
```

Set this in `.env.local`, then restart the Next.js development server:

```dotenv
NEXT_PUBLIC_WHISPER_URL=http://127.0.0.1:8765
```

Choose **Own media**, select a file, and leave the transcript blank. The browser sends it directly to the service with a five-minute client timeout. The default model is `base`; set the service's `WHISPER_MODEL` environment variable to `small` for a larger model. Only one transcription runs at a time, uploads are limited to 250 MB, and temporary files are removed after processing.

The service allows the local app origins `http://localhost:3000` and `http://127.0.0.1:3000`. It is intended for local use and is not launched by `npm start` or a GitHub hosting integration. Leave `NEXT_PUBLIC_WHISPER_URL` unset for the hosted app and use subtitle import there. This optional service has not been verified in this development environment.

## Architecture

The app uses **Next.js 16 App Router, React 19, TypeScript, authored CSS, and Lucide icons**. Cloudflare Workers via vinext is the canonical production target; Next.js runs locally. Route handlers provide caption preparation and translation. Production caption retrieval uses a small authenticated Worker/Durable Object broker and an outbound Node relay on a host whose YouTube access works. The app and media player remain on Cloudflare.

| Location | Responsibility |
| --- | --- |
| `src/app/` | Home/practice routes, styles, error and not-found pages |
| `src/components/home.tsx` | URL preparation, progress, demo, recent lessons |
| `src/components/practice.tsx` | Playback state, boundaries, navigation, transcript, bookmarks, lazy translation |
| `src/components/media-player.tsx` | YouTube IFrame and HTML media playback adapter |
| `src/components/voice-recorder.tsx` | Permissions, MediaRecorder, A/B listening, cleanup |
| `src/components/import-dialog.tsx` | Subtitle/media import and optional transcription |
| `src/lib/storage.ts` | Browser persistence and session media URLs |
| `src/lib/segmentation.ts` | Caption validation, cleanup, deduplication, sentence/clause grouping |
| `src/lib/subtitles.ts` | SRT, WebVTT, and JSON parsing |
| `src/lib/providers/` | Caption, translation, and local Whisper implementations |
| `src/lib/types.ts` | Lesson/section models and provider contracts |
| `src/app/api/prepare/route.ts` | `POST { url }`; NDJSON progress and lesson/error result |
| `src/app/api/translate/route.ts` | `POST { japanese, previousJapanese?, nextJapanese? }`; contextual translation result with bounded cache |
| `src/data/demo.json`, `public/demo.*` | Bundled lesson transcript and media |
| `scripts/caption-relay.ts` | Outbound Node caption relay, bounded concurrency/cache and reconnects |
| `tools/caption-relay-worker/` | Authenticated Cloudflare broker with a hibernating WebSocket Durable Object |
| `tools/whisper_service.py` | Optional local Python transcription service |
| `cloudflare-worker.js`, `src/lib/demo-asset.ts` | vinext entry wrapper and bounded demo byte-range responses |
| `tests/` | Unit and Playwright browser tests |

Playback boundaries are checked every 35 ms while listening. YouTube reports time less precisely than HTML media, so some boundary overshoot is possible. Shadowing pauses when the tab becomes hidden to avoid timer-throttling overshoot; continuous mode keeps playing.

## Checks and development commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

For browser tests, install Chromium once and run the app in a separate terminal:

```sh
npx playwright install chromium
npm run test:e2e
```

Unit tests cover segmentation, rolling/overlapping captions, boundaries, subtitle parsing, URL validation, demo timing, caption error classification, provider fallback, relay validation/authentication, redirect rejection and bounded upstream reads. Browser tests cover bundled playback/pausing, replay/navigation, authored translation reveal, speed, continuous mode, position-preserving mode switches, refresh, microphone success/denial, local media/subtitle import and reattachment, bookmarks, search, keyboard typing guards, and mobile layout.

`PLAYWRIGHT_BASE_URL` selects a running app other than `http://localhost:3000`; `PLAYWRIGHT_CHROME_PATH` selects an existing Chromium executable. Tests use a fake microphone source with the real `MediaRecorder` API.

To manually exercise the real caption and translation providers against a running app:

```sh
node scripts/check-integrations.mjs http://localhost:3000
node scripts/check-integrations.mjs https://shadowing.julianpopovskijones.workers.dev
node scripts/check-youtube-browser.mjs https://shadowing.julianpopovskijones.workers.dev IJ6R4u05ppw
node scripts/check-youtube-browser.mjs https://shadowing.julianpopovskijones.workers.dev KJblreFQ2R8
```

The integration script checks both `IJ6R4u05ppw` and `KJblreFQ2R8`, records HTTP status, NDJSON events/timing, normalized lessons and translation results in ignored `artifacts/`, and exits unsuccessfully if either external service fails. Additional video IDs/URLs can follow the base URL. The browser script uses installed Chrome (or `PLAYWRIGHT_CHROME_PATH`) and verifies preparation, practice navigation, real YouTube playback, automatic pause, replay, transcript navigation and refresh persistence. A fourth argument containing an integration report exercises manual transcript import. These real network checks are separate from deterministic tests.

`npm run demo:generate` rebuilds the sample from [scripts/demo-lines.json](scripts/demo-lines.json). It uses Edge TTS's Japanese Nanami voice, FFmpeg, Sharp, and the bundled illustration. This development command requires network access; normal playback uses the checked-in MP4 without TTS dependencies.

## Hosting

### Cloudflare Workers

The Cloudflare deployment uses vinext and the typed configuration in `cloudflare.config.ts`.
Configure Workers Builds with these commands:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:vinext` |
| Deploy command | `npx @vinext/cloudflare deploy --skip-build` |
| Node.js version | 24.x |

The app uses vinext's Workers Cache adapter for page responses. Practice data remains in the browser. Automatic captions additionally use `shadowing-caption-relay`, a separate Worker with a SQLite Durable Object coordinating an authenticated outbound WebSocket. It does not store lessons or user progress. No R2 bucket, paid caption API, tunnel subscription, or video hosting is introduced. The relay host must remain online; see [setup, secrets, health checks and limitations](docs/production-captions.md). `--skip-build` reuses the output from the build command.

For a local build and deployment, sign in to Cloudflare and run `npm run deploy:vinext`.

### Local Next.js build

The standard Next.js build remains available for local production checks with `npm run build` and `npm start`. Cloudflare is the production deployment target.

| Setting | Value |
| --- | --- |
| Project/root directory | Repository root |
| Node.js version | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output | `.next` |
| Required environment variables | None for local direct retrieval, demo and imports |
| Self-hosted Node start command | `npm start` |

Caption/translation API routes require server support, so this is not a static GitHub Pages export. Dependencies, local hosting output, environment files, and test artifacts are ignored by Git. The optional Python service is not part of the hosted app.

## Limitations and intended next work

The app provides practice tools, not a pronunciation evaluator. **Pronunciation scoring is not implemented**; `PronunciationAnalysisProvider` is only an extension interface. Recordings are not saved/exported, and practice data does not sync across devices. Free caption and translation services can fail or impose limits; the bundled demo and subtitle import provide alternatives.

The current product priority after comprehension testing, content difficulty analysis, and the local learner profile is the polish / monetisation layer. Content-source/file-upload expansion comes later in the ordered roadmap. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) is the product and engineering source of truth.
