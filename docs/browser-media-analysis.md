# Browser analysis and larger media imports

Hibiki keeps native media playback and the current Next.js/vinext/Cloudflare architecture. Local media can be up to 1 GiB. Automatic Japanese subtitles prepare only audio in a lazy browser worker; the original file remains the player's source. No video-hosting service, storage bucket, new Cloudflare binding, WASI runtime or cross-origin isolation header is introduced.

## Japanese analysis

Readings and morphology share one versioned, bounded canonical-text analysis cache. Furigana, dictionary lookup, Shadowing normalization, topic vocabulary and word coverage reuse those tokens. Background transcript work uses bounded batches with separate sentence inputs and opportunities for interactive work between batches. Cancellation suppresses stale consumers without destroying shared canonical results. Existing public reading/morphology interfaces and token-derived behavior remain compatible.

Kuromoji/IPADIC remains the engine. The isolated Lindera 6.2.0 experiment found no warm median/p95 speedup and three output differences in a 22-sentence sample. A default engine replacement is gated on browser memory/cold-start benefit and semantic parity; this change does not ship an unverified engine or add Rust compilation to deployment.

## Audio-only subtitle generation

The browser reads source media through Mediabunny's bounded Blob source. Compatible AAC tracks are copied into audio-only MP4 parts without decoding or re-encoding, including on browsers without WebCodecs audio decoding. Other supported browser codecs decode only the audio track into mono 16 kHz PCM WAV, approximately 1.92 MB per minute. Video frames are not decoded for transcription. Roughly two-minute parts stay under the existing 32 MiB request bound; copied AAC payloads have an additional 8 MiB preparation bound. Input audio is bounded to four hours. A high-bitrate video can therefore exceed the previous transcription-file limit without increasing the inference request size.

Keep original presentation timestamps and track start offsets when producing adjacent audio parts. Decoded WAV preserves internal gaps; compressed stream copy rejects discontinuous packet timelines. Convert returned cue times onto the original media timeline; repeated speech must not be removed merely because the text is the same. Parts do not overlap, avoiding duplicate recognition and repeated billable audio. The merged cues go through existing transcript validation and shadowing segmentation.

Browser/codec capability failures explain how to use manual subtitles or extracted audio. The pipeline must not silently send the original video as a fallback. Native playback and extraction have separate codec capabilities: readable audio does not guarantee the video codec will play. YouTube/Vimeo remain embedded players; automatic generation for a link requires a matching user-selected file.

The client queue is sequential and cancellable. Each provider request has a bounded timeout rather than one five-minute limit on the entire import. Completed parts have bounded account-scoped session checkpoints, verified against source identity and exact audio bytes before reuse; only subtitle results and fingerprints are stored, not recordings or the video. A refresh requires reattaching the file. Network timeouts are not automatically replayed as they may already have incurred a billable call. Rate-limit responses receive bounded delayed retry. Cloudflare reuses the existing rate-limit binding on this route, with the existing Pro gate, body bound and additional prepared-PCM validation.

Audio extraction reduces upload bytes and request memory, not audio-duration-based Whisper charges. Manual retry may add billable audio. No silence removal, model replacement or hosted-job infrastructure is introduced. The optional local Whisper route keeps its existing contract and limits.

## Local recording checks

An explicit local action inspects a short microphone recording without an inference request. Native decoding prepares bounded 16 kHz PCM for a background numeric worker. Recording limits remain approximately one minute and 8 MiB; recordings are never stored by this feature. Cancellation, new recordings, navigation and account changes discard stale work. Native A/B replay and microphone cleanup retain their existing lifecycle.

Feedback describes estimated sound activity, pauses, low level and clipping. Accessible demo/local audio can also supply bounded source excerpts for descriptive active-duration and pause comparisons at the selected playback speed. Noise, music and microphone processing can affect these measurements; they are not authoritative speech or pronunciation judgments. Score weights, versions, timing normalization, historical trends and the existing Pro AI analysis remain unchanged. Reference-based rhythm scores, pitch/prosody and composite scores require separate calibration; embedded players do not expose reference PCM.

## Build and checks

The existing `furigana:prepare` asset hook compiles the lazy browser workers and retains Mediabunny's MPL-2.0 license alongside the existing IPADIC/library notices. Media/DSP workers are not imported by the application server or Cloudflare server bundle. Use the same npm install, dev, build and deploy commands as before.

Verification covers canonical token parity, deduplicated/bounded scheduling, independent cancellation, actual browser audio extraction, large sparse video input, original-source playback, chunk timelines, checkpoint isolation, rate limits, cancellation, malformed/missing codecs and synthetic plus native-recording diagnostics. Run typecheck, lint, formatting, unit tests, both builds, local D1 verification and Playwright against both production runtimes. Real-provider transcript quality, phone memory/thermal limits and future WASM engine adoption remain separate measured gates; deterministic provider fixtures do not establish those results.
