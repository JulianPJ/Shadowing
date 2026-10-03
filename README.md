# Hibiki — Japanese shadowing practice

Hibiki is a personal Japanese listening and speaking practice app. It turns timestamped speech into short sections so you can **listen → pause → repeat aloud → replay → continue** at your own pace.

The intention of this repository is to make regular shadowing easy: use Japanese YouTube captions or your own media and subtitles, focus on the sound first, and reveal English only when you need it. It is a working practice prototype with replaceable transcription and translation providers. The core app needs no account, database, paid API key, or model download.

## Quick start

Use Node.js **24.x**, as specified in `package.json`, and npm.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and choose **Try the demo**. Alternatively, paste a Japanese YouTube URL or choose **Import media or subtitles**. On Windows PowerShell with script execution restricted, use `npm.cmd` and `npx.cmd`.

For a production build:

```sh
npm run build
npm start
```

No environment variables are required for the demo, subtitle import, YouTube captions, or translation. [.env.example](.env.example) documents the optional local Whisper setting.

## Features and practice flow

1. **Choose a lesson.** Start the bundled demo, prepare a YouTube video with Japanese captions, or pair your own audio/video with timestamped subtitles.
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

## YouTube and subtitle import

Paste a YouTube URL to request existing **Japanese captions** using `youtube-transcript-plus`. Video metadata comes from YouTube's official oEmbed endpoint when available. Playback uses the official YouTube IFrame player.

Caption retrieval is unofficial and can fail due to missing captions, YouTube changes, video restrictions, or server network/IP limits. Embedding may also be disabled by the owner. The app does not download/re-host YouTube videos or generate captions for captionless videos. Use **YouTube + subtitles**, your own media, or the demo when preparation fails.

### Transcript formats

Import **SRT, WebVTT, or JSON**, or paste timestamped transcript text. Subtitle files may be up to **2 MB**. [public/demo.vtt](public/demo.vtt) is a ready-to-use example.

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

Choose **Import media or subtitles → Own media**, then select media and Japanese subtitles. Formats depend on the browser's codecs; common choices include MP4, WebM, MP3, WAV, and M4A. Media is limited to **250 MB**.

With subtitle import, media stays in the browser. After a full refresh, the transcript and last section remain saved, but you must reattach the original media file. Browser object URLs survive only the current session.

## Translation, storage, and privacy

Demo translations are authored, and imported translations are used when supplied. Other sections request Japanese-to-English translation from **MyMemory** only when revealed. The current sentence is sent through the app's API to that external service. Responses are cached in the browser and a bounded in-memory server cache.

The keyless service has quotas and variable quality. Failures show a retryable message and do not prevent playback. See [MyMemory's API documentation](https://mymemory.translated.net/doc/spec.php). Another implementation can replace `TranslationProvider`.

Practice data lives in browser `localStorage`, scoped to the current origin/browser/device. There are no accounts, hosted database, or cross-device synchronization. Clearing site storage removes saved practice data. Recordings stay in memory and are neither uploaded nor persisted. YouTube requests and requested MyMemory translations require network access. Optional Whisper transcription sends selected media directly to the configured local service.

Recording requires a browser with `MediaRecorder`, a microphone, permission, and **HTTPS or localhost**. Denied permission shows a recovery message while playback remains available.

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

The app uses **Next.js 16 App Router, React 19, TypeScript, authored CSS, and Lucide icons**. Node route handlers provide caption preparation and translation; the core app requires no separate backend service.

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
| `src/app/api/translate/route.ts` | `POST { japanese }`; translation result with bounded cache |
| `src/data/demo.json`, `public/demo.*` | Bundled lesson transcript and media |
| `tools/` | Optional local Python transcription service |
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

Unit tests cover segmentation, rolling/overlapping captions, boundaries, subtitle parsing, URL validation, and demo timing. Browser tests cover bundled playback/pausing, replay/navigation, authored translation reveal, speed, continuous mode, position-preserving mode switches, refresh, microphone success/denial, local media/subtitle import and reattachment, bookmarks, search, keyboard typing guards, and mobile layout.

`PLAYWRIGHT_BASE_URL` selects a running app other than `http://localhost:3000`; `PLAYWRIGHT_CHROME_PATH` selects an existing Chromium executable. Tests use a fake microphone source with the real `MediaRecorder` API.

To manually exercise the real caption and translation providers against a running app:

```sh
node scripts/check-integrations.mjs
# Or supply the hosted app's URL:
node scripts/check-integrations.mjs https://your-app.example
```

The script uses `https://www.youtube.com/watch?v=IJ6R4u05ppw` and writes caption diagnostics to ignored `artifacts/`. This check depends on external service availability and is separate from deterministic tests.

`npm run demo:generate` rebuilds the sample from [scripts/demo-lines.json](scripts/demo-lines.json). It uses Edge TTS's Japanese Nanami voice, FFmpeg, Sharp, and the bundled illustration. This development command requires network access; normal playback uses the checked-in MP4 without TTS dependencies.

## Hosting through GitHub integration

### Cloudflare Workers

The Cloudflare deployment uses vinext and the typed configuration in `cloudflare.config.ts`.
Configure Workers Builds with these commands:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:vinext` |
| Deploy command | `npx @vinext/cloudflare deploy --skip-build` |
| Node.js version | 24.x |

The app uses vinext's Workers Cache adapter for page responses. It deploys as one
Worker and requires no R2 bucket, Durable Object storage, or separate cache Worker.
The app does not use a durable server data cache; practice data remains in the
browser. `--skip-build` reuses the output from the build command.

For a local build and deployment, sign in to Cloudflare and run `npm run deploy:vinext`.

### Next.js hosting

Connect this GitHub repository manually to your hosting provider and select its **Next.js** integration. The repo uses the standard build flow; no deployment CLI, provider credentials, local project linkage, or custom build-output conversion is required.

| Setting | Value |
| --- | --- |
| Project/root directory | Repository root |
| Node.js version | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output | Framework default (`.next`), managed by the Next.js integration |
| Required environment variables | None |
| Self-hosted Node start command | `npm start` |

Caption/translation API routes require server support, so this is not a static GitHub Pages export. The hosting integration should handle deployments from GitHub. Dependencies, local hosting output, environment files, and test artifacts are ignored by Git. The optional Python service is not part of the hosted app.

## Limitations and intended next work

The app provides practice tools, not a pronunciation evaluator. **Pronunciation scoring is not implemented**; `PronunciationAnalysisProvider` is only an extension interface. Recordings are not saved/exported, and practice data does not sync across devices. Free caption and translation services can fail or impose limits; the bundled demo and subtitle import provide alternatives.

The highest-value improvements are word-level timing alignment, human-recorded sample lessons, an optional local Japanese translation provider, and on-device recording persistence. Furigana, automatic looping, and configurable practice pauses are future ideas, not current features.
