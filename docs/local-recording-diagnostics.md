# Local recording checks

After recording an attempt, **Check recording locally** measures sound activity, internal pauses and recording level on the device. It is available without Pro. The existing explicit Pro **Analyse attempt** action also starts the local check while its existing Cloudflare transcription runs. Local checks add no inference request, storage record or score input.

The learner keeps the original recording for native A/B playback. Deleting it, recording again or changing sections discards local measurements and cancels pending work. Microphone requests, recording, manual stop and automatic drills retain their existing lifecycle. A later account/section cancellation suppresses queued stop results. Starting a new recording disables analysis of the preceding Blob.

Where the player supplies an accessible bundled-demo or reattached local-media reference, the same action can also measure the current source excerpt. Reference extraction reads a bounded range through the media worker; it does not decode the entire source. Both recordings must have clear activity before reference measurements appear. The selected playback speed changes the reference analysis clock, including its pause threshold. YouTube, Vimeo and arbitrary cross-origin URLs have no reference comparison. Source decoding failures leave the learner check and playback available.

## Measurements and limits

`audio-diagnostics-client.ts` accepts only microphone/excerpt Blobs: at most 8 MiB encoded, 61 seconds of original audio and 61 seconds on the selected playback clock. Elapsed recording time is checked before native decoding, protecting against microphone timers delayed by background throttling. Native `OfflineAudioContext` decodes/resamples to 16 kHz; mono/stereo PCM copies yield between bounded chunks, then transfer to a lazy ephemeral worker. A 60-second stereo input contains 7.68 MB of copied PCM. Native decoder memory is additional; this is not a measured peak-memory guarantee for phones.

The worker uses 20 ms energy frames, a conservative adaptive background threshold, an absolute level floor and minimum activity duration. Isolated clicks are suppressed, short gaps are bridged, and longer internal pauses are retained. Stereo energy is measured independently rather than downmixed, so opposite-phase channels cannot cancel. Near-full-scale sample incidence and a bounded energy envelope are computed locally. The worker terminates after completion, error or cancellation. Native decoding itself cannot be aborted; cancelled results are ignored and cannot create a new worker.

These are signal estimates. Background noise/music can count as activity; quiet speech can be missed; a steady signal is deliberately marked uncertain. Resampling and codec reconstruction can alter decoded peaks. Measurements do not identify phonemes, Japanese pitch accent or pronunciation, and do not diagnose a microphone. The UI offers descriptive feedback and listening guidance, never a new rhythm/prosody score. Existing Shadowing Match weights, score version, recognition span, suggestions and trends are unchanged.

## Verification

Focused unit checks:

```sh
node --import tsx --test tests/audio-diagnostics*.test.ts
```

They cover silence, quiet signals, steady/background signals, clicks, phrase pauses, opposite-phase stereo, clipping, malformed samples, duration/channel bounds, bounded output, selected-speed timing, decoder/worker failure and cancellation before/after worker creation. Native browser tests exercise explicit local-only processing, recording replacement, replay, deletion, unsupported decoding, delayed native decode cancellation and microphone cleanup on a later account interruption. Existing scored-recorder browser contracts remain required on both production runtimes.

Reproduce the isolated numeric workload:

```sh
node --import tsx scripts/benchmark-audio-diagnostics.mjs
```

The onboarding machine measured one 60-second stereo synthetic input at approximately 21 ms for its first numeric analysis and 14 ms warm p50 / 19 ms p95 over 20 runs. This excludes native decode, file extraction, worker startup and UI rendering, and does not establish phone performance or calibrated Japanese feedback quality. The inexpensive JS worker is retained; WASM adoption needs a measured benefit. Real Japanese learner/reference recordings and diverse phone/microphone validation remain necessary before developing stronger speech or prosody claims.

The worker is bundled through the existing `furigana:prepare` hook to `/furigana/v1/audio-diagnostics-worker.js`. Next.js/vinext build and Cloudflare deploy commands, Worker bindings and database schemas remain unchanged.
