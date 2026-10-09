# Media sources and transcripts

**Supported links.** The home entry point accepts:

- **YouTube:** watch, shortlink, Shorts, live-recording and embed URLs;
- **Vimeo:** video, player, channel, group and unlisted links;
- **direct links** to HTTP(S) audio or video files.

Remote bytes play in the browser; the Worker never proxies them. Live streams without a finite, seekable duration cannot support section replay.

**Getting subtitles for a link**

- **YouTube** captions come through the production relay, with a direct fallback. When there are genuinely no Japanese captions (`no-japanese-captions`), **Video link + transcript** opens with the link, title and author kept.
- **Errors stay separate.** Network errors, relay outages, bot blocking and private videos each get their own message, with manual subtitles as the recovery.
- **Vimeo and direct links** have no caption integration and go straight to the subtitle dialog.

**Videos on other sites** play through the [Hibiki Bridge](browser-extension.md) extension; Hibiki never scrapes or re-hosts them.

## Versioned contracts

[types.ts](../src/lib/types.ts) holds the exact types:

```ts
type LinkedMediaSource = { schemaVersion: 1; canonicalUrl: string; contentKey: string } & (
  | { type: 'youtube'; provider: 'youtube'; videoId: string }
  | { type: 'vimeo'; provider: 'vimeo'; videoId: string }
  | { type: 'direct'; discoveredFrom?: string } // discoveredFrom: legacy lessons only
);
type PageMediaSource = { schemaVersion: 1; type: 'page'; canonicalUrl: string; pageKey: string };
type MediaSource =
  | LinkedMediaSource
  | PageMediaSource
  | { schemaVersion: 1; type: 'local'; fileName: string }
  | { schemaVersion: 1; type: 'demo' };
```

`TranscriptSource` records how the subtitles were obtained (`provider-captions`, `user-upload`, `user-paste`, `generated` or `authored`), plus provenance, hash and normalisation and segmentation versions.

**Players.** Practice drives every player through `MediaHandle` (`play`, `pause`, `seek`, `time`, `setSpeed`, `isPlaying`) plus ready, playing, ended and error callbacks. Each adapter is isolated from Practice:

| Adapter | Behaviour |
| --- | --- |
| YouTube | Embedded player |
| Vimeo | Commands run in order; time is polled, never extrapolated; creator-disabled speed changes get a status message |
| HTML | Native `<audio>`/`<video>` |
| Page | `media-page.tsx`; commands go through the extension, and time is estimated between video events |

Another embed provider needs both a resolver and a complete control adapter.

**Identity**

- Linked content keys are `youtube:<id>`, `vimeo:<id>` and `direct:<SHA-256(canonicalUrl)>`.
- Canonical direct URLs keep their query and drop the fragment.
- Vimeo access hashes and direct signed queries stay in the playback URL and never appear in IDs or logs.
- A renewed signed URL can change a direct identity.
- Page lessons use `pageKey` (`page:<SHA-256(url)>`) and never enter the shared content cache.

**Transcript hashes.** SHA-256 hashes cover the normalised cues only, independent of title, media and user.

## Migration and privacy

**Saved legacy lessons** migrate on read and save. Lesson IDs, segment IDs and timings are unchanged; unknown source versions fail safely.

**Local media**

- Local media has no shared content key and plays from an object URL. After a refresh, the learner reattaches the file.
- Imported transcripts stay private and in the browser. Adding a public link does not publish them.
- Only Whisper subtitles (Pro) send audio from a file or page, and only audio windows ([details](browser-media-analysis.md)).

## Subtitle and file support

**Subtitle files**

- SRT, WebVTT, JSON, ASS and SSA share one cue validator.
- ASS and SSA read `[Events]` Dialogue rows using the declared Format columns. Override tags and drawings are removed, and `\N`, `\n` and `\h` are normalised.
- TXT must use the same timestamped syntax; untimed prose is rejected.
- Limits are 2 MB, 15,000 cues and 24-hour timestamps.

**Media files**

- Local media is accepted by MIME type plus common extensions (MP4/M4V, WebM, MOV, MP3/M4A/AAC, WAV, OGG/OGA/OGV, FLAC), up to 1 GiB.
- The browser decides what it can decode; there is no transcoding.

## Hosted transcripts

[linked-transcripts.ts](../src/lib/linked-transcripts.ts) defines `LinkedTranscriptRepository`, with a native D1 implementation.

- D1 stores provider captions with system visibility, plus trusted quiz and difficulty artifacts derived from them.
- User-supplied, Whisper-generated and page transcripts stay in the browser.
- Stored media identity excludes playback URLs, Vimeo hashes and signed queries.
- See [storage](storage.md).

```text
resolve linked media identity
  → D1 shared transcript (YouTube provider captions)
  → provider Japanese captions (YouTube only)
  → unavailable: the learner's subtitles, or Whisper from a local file or page (Pro)
  → validate, normalise, segment
```

## Verification

- [media.test.ts](../tests/media.test.ts) covers provider URLs, unsafe input, content identities, every subtitle format, migration, size bounds, no-caption versus infrastructure failures and ordered Vimeo controls.
- [media.spec.ts](../tests/e2e/media.spec.ts) covers YouTube preparation, no-caption continuation, direct media with ASS/SSA on mobile, timestamped TXT and the real Vimeo SDK behind a mocked iframe boundary.
- Page media is covered by `tests/extension.test.ts` and `tests/e2e/extension.spec.ts`.
- No test calls a live provider.
