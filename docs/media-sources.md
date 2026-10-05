# Video links and independent transcripts

The primary entry point accepts YouTube (watch, shortlink, Shorts, live-recording and embed URLs), Vimeo (video, player, channel, group and unlisted links), and direct HTTP(S) audio/video files. Live streams without finite, seekable duration are unsuitable for section/evidence replay. Remote bytes play in the browser; the Worker never proxies them.

YouTube automatic Japanese captions still use the existing production relay/direct chain. A genuine `no-japanese-captions` result opens **Video link + transcript**, retaining the original link, normalized source, identity, title and author. Network errors, relay outages, bot blocking and unavailable/private videos stay separate errors with manual transcript recovery. Vimeo/direct media currently have no automatic caption integration and immediately offer the transcript dialog.

## Public media discovery

For an otherwise unsupported page link, the browser attempts a credential-free CORS fetch with an 8-second timeout, a 1 MB HTML bound and redirects disabled. It examines `<video>`/`<audio>` sources, OpenGraph video metadata and VideoObject/AudioObject JSON-LD `contentUrl` in an unattached, inert HTML template. Relative media sources resolve against the page URL. Extensionless media can be recognized through a browser-playable MIME type. Extracted media is exposed through **Open extracted media** and uses the HTML media adapter.

The app does not execute the page, follow arbitrary iframe URLs, inspect player scripts or intercept protected streams. CORS denial, authentication, redirects, DRM, expired signed URLs, referrer/embedding restrictions, unsupported codecs and pages without public media metadata can prevent this path. A page allowing iframe embedding alone does not provide Hibiki's required playback controls. Discovery rejects local-network/IP page and extracted-media targets. No server-side scraping endpoint or third-party-media re-hosting exists. Browser requests necessarily contact the submitted public host; URLs are never written to application diagnostic logs.

## Versioned contracts

The exact contracts are in [types.ts](../src/lib/types.ts):

```ts
type LinkedMediaSource = {
  schemaVersion: 1;
  canonicalUrl: string;
  contentKey: string;
} & (
  | { type: 'youtube'; provider: 'youtube'; videoId: string }
  | { type: 'vimeo'; provider: 'vimeo'; videoId: string }
  | { type: 'direct'; discoveredFrom?: string }
);

type MediaSource = LinkedMediaSource
  | { schemaVersion: 1; type: 'local'; fileName: string }
  | { schemaVersion: 1; type: 'demo' };

type TranscriptSource = {
  schemaVersion: 1;
  type: 'provider-captions' | 'user-upload' | 'user-paste' | 'generated' | 'authored';
  language: 'ja';
  provenance: string;
  provider?: string;
  transcriptHash?: string;
  normalizationVersion: 1;
  segmentationVersion: 1;
};
```

`Lesson.mediaSource` and `Lesson.transcript` are additive versioned fields. The legacy `source`, YouTube-only `videoId`, and human-readable `transcriptSource` label remain for saved learning artifacts. Practice operates through `MediaHandle` (`play`, `pause`, `seek`, `time`, `setSpeed`, `isPlaying`) and ready/playing/ended/error callbacks. YouTube, Vimeo and HTML implementations are isolated from Practice. Vimeo commands are serialized, real current time is polled without extrapolation, and creator-disabled speed changes receive an explicit status message. Other embed providers remain unsupported until both a resolver and a complete control adapter exist.

Linked content keys are `youtube:<id>`, `vimeo:<id>`, and `direct:<SHA-256(canonicalUrl)>`. Canonical direct URLs retain all query parameters and remove fragments; scheme/host/default ports use URL normalization. Vimeo access hashes stay in the playback URL and never appear in IDs. Direct signed queries are needed for playback and browser-local persistence, but never appear in readable generated IDs/logs. Signed URL renewal can change direct identity because there is no reliable provider identity for arbitrary files.

Transcript SHA-256 hashes cover validated normalized cues, independently of title, media identity, lesson/quiz/difficulty/user IDs. Existing learning artifact fingerprints remain unchanged. Future artifacts may key on contentKey + transcriptHash + artifact type + generator/schema version.

## Migration and privacy

Saved legacy lessons are migrated on read/save without changing lesson IDs or segment IDs/timings. YouTube source identity is inferred from the validated existing video ID; demo/local contracts are inferred from source and file name. Legacy transcript provenance is preserved and acquisition type is inferred conservatively. Missing legacy cue hashes are left optional because only segmented text survives; they are not falsely presented as original cue hashes. Unknown source versions fail safely. History is migrated for display. Existing quizzes, difficulty records, attempts and learner history retain their own identities.

Local media has no globally reusable content key. It remains browser-local, session-bound via object URLs and needs reattachment after a full refresh. Transcript imports are private/browser-local; adding a public video link does not publish the uploaded transcript. The existing explicitly configured local Whisper flow is the only import path that sends selected local media to a transcription service.

## Transcript and file support

SRT, WebVTT, JSON, ASS and SSA share Cue validation. ASS/SSA read `[Events]` Dialogue rows with declared Format columns (or standard positions), centisecond timestamps, commas in text, override-tag removal, drawing suppression and `\N`/`\n`/`\h` normalization. Malformed structures/timestamps/tags receive errors. TXT is only a container for the same timestamped syntax; untimed prose is rejected. Subtitle files remain limited to 2 MB, 15,000 cues and 24-hour timestamps.

Local audio/video selection uses media MIME categories plus common extension hints, including MP4/M4V, WebM, MOV, MP3/M4A/AAC, WAV, OGG/OGA/OGV and FLAC. The 250 MB bound remains. The browser decides decoding support and supplies a clean playback error; no transcoding or universal codec support is promised.

## Hosted transcript storage and future generation

[linked-transcripts.ts](../src/lib/linked-transcripts.ts) defines `LinkedTranscriptRepository.lookup({ contentKey, language })` / `save(StoredTranscript)`, a native D1 production implementation, and a no-op ordinary Next development fallback. `StoredTranscript` carries schema/content/media/language/source identity, normalized cues, transcript hash, timestamp, explicit visibility and optional generator/model/owner metadata. A real repository must enforce visibility/access policy; user-supplied transcripts must stay private by default. D1 stores provider captions with system visibility and trusted derived quiz/difficulty artifacts. Stored media identity excludes playback URLs, Vimeo hashes and signed queries. See [storage and migration workflow](storage.md).

`GeneratedTranscriptProvider.transcribe(LinkedMediaSource, AbortSignal)` is a contract only; there is no working remote AI transcription path, audio download or Generate subtitles button.

```text
resolve linked media identity
  → D1 shared transcript repository (no-op in ordinary Next development)
  → provider Japanese captions (YouTube only today)
  → unavailable: offer a user transcript now
  → FUTURE: generate through an approved audio-access path
  → validate/normalize
  → persist by contentKey + language + transcriptHash + provenance/visibility
  → reuse subject to access policy
```

The current non-YouTube browser path enters user import immediately; provider acquisition for these sources remains future work. The production preparation API can reuse an eligible stored linked transcript at the repository boundary. Hosted shared content storage is implemented. Accounts, hosted learner persistence and AI subtitle generation remain unimplemented.

## Verification

[media.test.ts](../tests/media.test.ts) covers provider URLs, unsafe input, content identities, ASS/SSA/SRT/VTT/JSON, transcript metadata, migration, size bounds, no-caption versus infrastructure failures and ordered Vimeo controls. [media.spec.ts](../tests/e2e/media.spec.ts) covers the generic homepage, YouTube preparation, no-caption continuation, direct media with ASS/SSA on mobile, timestamped TXT, inert public-source/metadata extraction and the real Vimeo SDK through a mocked iframe message boundary. Deterministic tests require no live provider calls.

Verified: 94 unit tests; all 35 Playwright tests on Next.js production and built Cloudflare/local workerd; typecheck, lint, Next build and vinext/Cloudflare build. Lint retains four pre-existing unused-code warnings. Local Worker verification uses an ignored, isolated Wrangler configuration with the built bundle/assets and production compatibility flags, omitting remote inference and secrets. Production now also binds HIBIKI_DB; see storage verification for the subsequent persistence phase.
