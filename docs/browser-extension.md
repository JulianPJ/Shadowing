# Hibiki Bridge (browser extension)

A web page cannot reach a video on another site, so Hibiki uses a small Chrome extension (Manifest V3) for videos outside YouTube, Vimeo and direct links. Where it can, the extension hands Hibiki the page's own stream and Hibiki plays it in its own player; otherwise it drives the page's `<video>` in its tab. Hibiki keeps the subtitles, practice loop and progress either way.

## What it does

1. On a page with a video, the learner clicks **Hibiki Bridge** and chooses **Practise in Hibiki**.
   - **YouTube watch, Shorts, live, embed, and youtu.be links** are matched by video ID: the popup shows one video regardless of extra HTML `<video>` elements. The extension opens `/prepare?video=...` with a canonical YouTube link and the site runs its existing `/api/prepare` Japanese caption pipeline.
   - **Other websites** use the page-video bridge in the following steps.

   Pasting a page link into Hibiki's link box does the same without the popup: a link that is not YouTube, Vimeo or a media file goes to the extension (`open-page`), which opens the page in a background tab, waits for its largest video with a known length (showing the tab after 6 seconds, for players that load only when visible), hands it over as below, and closes the tab once Hibiki plays the stream. This needs the all-sites access the popup asks for once; until then Hibiki explains how to grant it.
2. The extension injects a controller into the frame holding that video and reads its subtitle tracks. Some players (Vidstack, for example) fetch a subtitle file only once its track is chosen, so the extension also asks the page's own player to load its Japanese tracks while hidden, leaving the page's visible subtitles unchanged. It then opens Hibiki at `/?bridge=import`.
3. Hibiki asks the extension for the hand-off:
   - **With a Japanese track**, it builds the lesson straight away (`provider-captions`, labelled "Subtitles from the page"). Plain Japanese subtitles are preferred to SDH / CC and forced tracks.
   - **Without one**, the import dialog opens in page mode, saying the video has no Japanese subtitles, with **Find on Jimaku** chosen: when a Jimaku key is saved on Profile → Subtitle sources, Hibiki searches Jimaku for the page title (without the site's name) and the episode in the address (`?ep=8`, `episode-8`) or title, and picks the matching subtitle file. The learner can also upload or paste subtitles, or (Pro) generate them with Whisper.
4. In practice, the lesson's media adapter (`src/components/media-page.tsx`) asks the extension for the page's stream:
   - **Inside Hibiki** (`media-stream.tsx`): when the video plays a web file or an HLS playlist, Hibiki plays that stream in its own `<video>` (HLS through hls.js, loaded only for these lessons), with the same section timing, speed and Studio Mode as a direct link. The page's own copy is paused. The page tab can then be closed.
   - **In its own tab** (fallback): players that feed the video from script with no playlist to fetch, DASH, DRM, or a stream that fails to play. Hibiki plays, pauses, seeks and sets speed through the extension, and its current line is drawn over the original video, including in fullscreen.
5. A stream found at import is kept for the browser session, so reopening the lesson plays straight away. After a restart, or when the stream has expired, the lesson waits for its page: opening it and choosing **Connect to my Hibiki lesson** in the popup reconnects it and finds a fresh stream.

**Playing a page's stream.** Stream servers often answer only their own player: they check the request's `Origin` or `Referer` and allow cross-origin reads only for that player's site. The controller records the video's origin and the hosts its frame loaded media from. When Hibiki asks for the stream, the service worker adds one `declarativeNetRequest` session rule for that Hibiki tab: requests Hibiki itself makes to those hosts carry the page's origin and referrer, and their responses may be read by Hibiki. Nothing else is changed, and the rule is removed when the tab closes. This needs host access for the stream's site, so the popup asks for `<all_urls>` the first time the learner chooses Practise; declining keeps the video in its own tab.

**Whisper from a page.** The controller captures the element's audio with `captureStream()` while the video plays at normal speed from the start. It resamples to 16 kHz mono and places samples by media time, so pauses and stalls do not shift the timeline. It hands Hibiki 116-second WAV windows that overlap by 4 seconds. Hibiki sends each window through the existing `/api/transcribe` path and merges them like file transcription. **Finish with what was heard so far** keeps the partial result.

## Pieces

| File | Role |
| --- | --- |
| `extension/manifest.json` | Permissions: `activeTab`, `scripting`, `storage`, `declarativeNetRequestWithHostAccess`; optional `<all_urls>` for embedded players and playing streams inside Hibiki |
| `extension/popup.*` | Lists the page's videos; Practise / Connect; Hibiki address setting |
| `extension/page-videos.js` | Describes a frame's videos, for the popup and for pasted links |
| `extension/youtube.js` | Shared YouTube URL validation / canonicalization for the popup and service worker |
| `extension/background.js` | Routes commands from Hibiki pages to connected tabs and video events back; finds page streams and adds their request rule; state in `chrome.storage.session` |
| `extension/bridge.js` | Content script on Hibiki origins only; relays `window.postMessage` traffic |
| `extension/controller.js` | Injected on demand into the chosen frame: playback, tracks, stream origin and hosts, overlay, audio capture |
| `extension/page-player.js` | Run in the page's own world: asks a player that loads subtitles on request (Vidstack) for its Japanese cues, and for the source it plays |
| `src/lib/extension/` | Hibiki side: protocol client, hand-off and stream validation, capture orchestration |
| `src/components/media-page.tsx`, `media-stream.tsx` | Page lessons: the stream inside Hibiki, or the page's tab |

## Security and privacy

- Commands are accepted only from Hibiki origins (`https://hibikiapp.net`, the former `workers.dev` production origin during migration, `localhost`, `127.0.0.1`), and only for tabs the learner connected from the popup.
- The extension needs no host permission to control a video in its tab: `activeTab` covers the clicked tab. Embedded players on other origins, and playing a stream inside Hibiki, prompt for optional access.
- A stream rule applies only to requests from Hibiki's own document in that tab, to the hosts the page's player used. The page's origin and hosts are read in the extension's isolated world, where the page cannot alter them.
- Page lessons store the page URL and a `pageKey`, never a shared content identity. They sync as metadata with `mediaAvailable: false`.
- Captured audio goes only to Hibiki's own transcription endpoint, under the same Pro check and rate limit as file transcription.

## Limits

- Chrome 116+ only. Firefox is not yet supported. See [Chrome Web Store release](chrome-web-store.md) for the packaging and submission process.
- DRM-protected or capture-blocking sites play but cannot be transcribed; use page subtitles or upload your own.
- Whisper capture runs in real time.
- Custom players that draw their own subtitles without `<track>` elements need imported subtitles, except Vidstack players, whose own track list is read.
- Streams that need the site's cookies, DASH, and DRM-protected video play in their own tab only.
- In its own tab, shadowing pauses while Hibiki's tab is hidden (background timers cannot keep section ends precise), so switching to the video tab stops the section. To watch there while practising, keep both visible: use the player's picture-in-picture button, or move the video tab into its own window beside Hibiki.

## Install (development)

`chrome://extensions` → Developer mode → **Load unpacked** → choose the `extension/` folder. The default production address is `https://hibikiapp.net`; if you installed an older build, reload the extension and update **Settings** in the popup. For a local Hibiki, use `http://localhost:3000`.

## Tests

- `tests/extension.test.ts`: hand-off validation, track choice, page lessons, sync and saved-word identity.
- `tests/extension-youtube.test.mjs`: canonical YouTube video detection and rejection of unrelated URLs.
- `tests/e2e/extension.spec.ts`: loads a copy of the extension into Chromium. The copy is granted all sites so no toolbar click or permission prompt is needed. It covers the page-subtitle lesson playing a referrer-protected video inside Hibiki with exact section pauses, the in-tab fallback for a script-fed video (remote playback, section pause, overlay), a player that loads subtitles only on request, and Whisper capture with a mocked transcription endpoint, plus single-choice YouTube routing to the native caption endpoint.
