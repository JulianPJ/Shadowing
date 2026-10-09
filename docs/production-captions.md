# Production caption operations

The production app runs on Cloudflare Workers/vinext at `hibikiapp.net`; the old `workers.dev` app hostname redirects browser navigation to the new site. The separate `shadowing-caption-relay.julianpopovskijones.workers.dev` broker URL remains unchanged. Automatic YouTube caption preparation is an implemented, verified subsystem.

## Current architecture

```text
/api/prepare
    ↓
configured relay provider
    ↓
shadowing-caption-relay Worker
    ↓
Durable Object / hibernating WebSocket
    ↓
outbound Node caption host
    ↓
youtube-transcript-plus
    ↓
normalized Japanese cues
    ↓
segmentation in the app Worker
```

The app keeps one direct caption-provider attempt as a fallback for relay infrastructure failures. All providers return the same normalized cue contract, so the UI, segmentation and media player do not depend on provider-specific behavior.

The broker uses bearer-token authentication, bounded request sizes/concurrency and timeouts. The Node host maintains a small in-memory caption cache. The broker does not store lessons or learner progress.

## Required production settings

The app Worker uses server-only settings:

```text
YOUTUBE_CAPTION_RELAY_URL=https://shadowing-caption-relay.julianpopovskijones.workers.dev
YOUTUBE_CAPTION_RELAY_TOKEN=<shared random secret>
```

The broker Worker requires the same token. Never expose these as `NEXT_PUBLIC_` variables.

For the outbound Node host, keep an ignored `.env.caption-relay` with the same values.

## Build and deploy

Typical deployment commands:

```sh
npm run build:caption-relay
npm run deploy:caption-relay
npm run build
npm run deploy
```

For initial secret installation or token rotation, use the repository's ignored secret-file workflow rather than committing credentials.

## Health check

With `.env.caption-relay` loaded:

```sh
node --env-file=.env.caption-relay --input-type=module -e "const r=await fetch(new URL('/health',process.env.YOUTUBE_CAPTION_RELAY_URL),{headers:{Authorization:'Bearer '+process.env.YOUTUBE_CAPTION_RELAY_TOKEN}});console.log(r.status,await r.json());"
```

Expect HTTP 200 with a connected host. Without authentication, expect HTTP 401.

## Verification

Real-network verification remains separate from deterministic tests:

```sh
node scripts/check-integrations.mjs https://hibikiapp.net
node scripts/check-youtube-browser.mjs https://hibikiapp.net IJ6R4u05ppw
node scripts/check-youtube-browser.mjs https://hibikiapp.net KJblreFQ2R8
```

The deployed flow has been verified with Japanese-caption fixtures through preparation, practice navigation, real playback, automatic pause, replay, transcript navigation and refresh persistence.

Use `jNQXAC9IVRw` as an external no-Japanese-caption fixture and `aaaaaaaaaaa` as an unavailable-video fixture when those checks are useful. External fixtures can change.

## Logging and troubleshooting

Structured logs include:
- `preparation.metadata`
- `captions.providers`
- `captions.upstream`
- `captions.fallback`
- `preparation.failed`
- `preparation.done`
- `caption-relay.result`

Logs carry provider/stage/video ID, status, timing and failure metadata without exposing signed caption URLs or browser secrets.

If caption preparation regresses, first verify:
1. the broker health endpoint;
2. whether the outbound host is connected;
3. whether the app Worker has the correct relay URL/token;
4. a known Japanese-caption fixture through `/api/prepare`;
5. the real browser check.

Do not reopen caption infrastructure as general roadmap work unless there is a reproducible production regression.

## Separate limitation: translation

MyMemory translation is independent from caption preparation and remains best-effort. Quota or translation failure must never block the shadowing lesson.