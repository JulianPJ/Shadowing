# Hibiki Bridge (browser extension)

A web page cannot control a video embedded on another site, so Hibiki uses a small Chrome extension (Manifest V3) for videos outside YouTube, Vimeo and direct links. The extension drives the page's own `<video>`; Hibiki keeps the subtitles, practice loop and progress.

## What it does

1. On a page with a video, the learner clicks **Hibiki Bridge** and chooses **Practise in Hibiki**.
2. The extension injects a controller into the frame holding that video and reads its subtitle tracks. It then opens Hibiki at `/?bridge=import`.
3. Hibiki asks the extension for the hand-off:
   - **With a Japanese track**, it builds the lesson straight away (`provider-captions`, labelled "Subtitles from the page").
   - **Without one**, the import dialog opens in page mode. The learner can upload or paste subtitles, or (Pro) generate them with Whisper.
4. In practice, the lesson's media adapter (`src/components/media-page.tsx`) plays, pauses, seeks and sets speed through the extension. The video plays in its own tab. Hibiki's current line is drawn over the original video, including in fullscreen.
5. Reopening a saved page lesson waits for its page. Opening the page and choosing **Connect to my Hibiki lesson** in the popup reconnects it.

**Whisper from a page.** The controller captures the element's audio with `captureStream()` while the video plays at normal speed from the start. It resamples to 16 kHz mono and places samples by media time, so pauses and stalls do not shift the timeline. It hands Hibiki 116-second WAV windows that overlap by 4 seconds. Hibiki sends each window through the existing `/api/transcribe` path and merges them like file transcription. **Finish with what was heard so far** keeps the partial result.

## Pieces

| File | Role |
| --- | --- |
| `extension/manifest.json` | Permissions: `activeTab`, `scripting`, `storage`; optional `<all_urls>` only for embedded players |
| `extension/popup.*` | Lists the page's videos; Practise / Connect; Hibiki address setting |
| `extension/background.js` | Routes commands from Hibiki pages to connected tabs and video events back; state in `chrome.storage.session` |
| `extension/bridge.js` | Content script on Hibiki origins only; relays `window.postMessage` traffic |
| `extension/controller.js` | Injected on demand into the chosen frame: playback, tracks, overlay, audio capture |
| `src/lib/extension/` | Hibiki side: protocol client, hand-off validation, capture orchestration |

## Security and privacy

- Commands are accepted only from Hibiki origins (production, `localhost`, `127.0.0.1`), and only for tabs the learner connected from the popup.
- The extension needs no host permission for ordinary pages: `activeTab` covers the clicked tab. Embedded players on other origins prompt for optional access.
- Page lessons store the page URL and a `pageKey`, never a shared content identity. They sync as metadata with `mediaAvailable: false`.
- Captured audio goes only to Hibiki's own transcription endpoint, under the same Pro check and rate limit as file transcription.

## Limits

- Chrome 116+ only. Firefox and the Chrome Web Store listing are not done.
- DRM-protected or capture-blocking sites play but cannot be transcribed; use page subtitles or upload your own.
- Whisper capture runs in real time.
- Custom players that draw their own subtitles without `<track>` elements need imported subtitles.

## Install (development)

`chrome://extensions` → Developer mode → **Load unpacked** → choose the `extension/` folder. For a local Hibiki, set the address under **Settings** in the popup (for example `http://localhost:3000`).

## Tests

- `tests/extension.test.ts`: hand-off validation, track choice, page lessons, sync and saved-word identity.
- `tests/e2e/extension.spec.ts`: loads a copy of the extension into Chromium. The copy is granted the stand-in site so no toolbar click is needed. It covers the page-subtitle lesson, remote playback and section pause, the overlay, and Whisper capture with a mocked transcription endpoint.
