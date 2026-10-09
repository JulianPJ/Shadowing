# Browser analysis and larger media imports

Local media can be up to 1 GiB and plays natively from the original file. Whisper subtitles prepare only the audio, in a lazy browser worker. The setup adds no video hosting, storage bucket, new Cloudflare binding, WASI runtime or cross-origin isolation header.

## Japanese analysis

Readings and morphology share one versioned, bounded analysis cache keyed by canonical text. Furigana, dictionary lookup, Shadowing normalisation, topic vocabulary and word coverage all reuse its tokens.

- Background transcript work runs in bounded batches, leaving room for interactive work in between.
- Cancellation stops stale consumers without discarding shared results.

Kuromoji/IPADIC is the engine. A Lindera 6.2.0 experiment showed no warm speedup and three output differences in 22 sentences. Replacing the engine is gated on a measured memory or cold-start benefit plus output parity.

## Whisper subtitles from a file

The worker (`src/lib/media-audio/worker.ts`) reads the file through Mediabunny's bounded Blob source.

**Preparing audio**

- Compatible AAC tracks are copied into audio-only MP4 parts without re-encoding.
- Other codecs decode only the audio, into mono 16 kHz WAV (about 1.92 MB per minute). Unusual AAC timelines also fall back to WAV.
- Video frames are never decoded.
- Audio is limited to four hours. The original video is never sent as a fallback.

**Windows and merging**

- Windows are 116 seconds long and overlap by 4 seconds (`audioChunkWindows`), so a sentence cut at one edge is heard whole in the next window.
- Each window keeps its place on the original media timeline, and returned cue times are mapped back onto it (`mapChunkCues`).
- `mergeChunkCues` deduplicates overlapping cues only when their **text** confirms it, using containment, near-identical text or a suffix–prefix splice.
- Repeated speech outside the overlap is never removed just because the words match.
- The merged cues go through the normal transcript validation and segmentation.

**Queue and retries**

- The queue is sequential and cancellable, with a timeout per request.
- Completed windows are checkpointed per account and session, and reused only when the source identity and exact audio bytes match. Only subtitle results and fingerprints are stored.
- After a refresh, the learner reattaches the file to resume.
- Timeouts are not replayed automatically, because the call may already have been billed. A 429 gets a bounded delayed retry.

**Server side.** `/api/transcribe` applies the Pro gate, the inference rate limit, the body bound and prepared-audio validation. The overlap adds about 3% more billable audio.

**Failures.** When the browser lacks a codec, the error explains how to use manual subtitles or extracted audio.

Page videos played through [Hibiki Bridge](browser-extension.md) use the same windows and merge. The audio is captured while the page's video plays.

## Local recording checks

An explicit local action inspects a short microphone recording, with no inference request.

- Native decoding prepares bounded 16 kHz PCM for a background worker.
- Recordings are limited to about one minute and 8 MiB, and this feature never stores them.
- New recordings, navigation and account changes discard stale work.

Feedback describes sound activity, pauses, low level and clipping. For demo and local audio it can also compare active duration and pauses with the source at the selected speed. These are descriptive measures, not pronunciation judgements. Embedded players expose no reference PCM.

## Build and checks

`furigana:prepare`, run before `dev` and `build`, compiles the lazy workers into `public/furigana/v1/` and keeps Mediabunny's MPL-2.0 licence with the other notices. The media and DSP workers are never imported by the server bundle.

Tests cover:

- token parity, scheduling and cancellation;
- audio extraction, large sparse input and window timelines;
- the overlap merge (`tests/media-audio.test.ts`);
- checkpoint isolation, rate limits and malformed codecs;
- recording diagnostics.

Real-provider transcript quality and phone memory and thermal limits need measurement on real devices.
