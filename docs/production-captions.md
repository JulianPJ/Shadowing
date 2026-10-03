# Production YouTube captions

The app stays at https://shadowing.julianpopovskijones.workers.dev on Cloudflare Workers/vinext. Direct YouTube caption retrieval is unreliable from Worker egress. A small free relay uses a host where YouTube retrieval works; no paid provider, media download, or video rehosting is involved.

## Confirmed diagnosis (2026-10-03)

Both supplied videos worked under local Next.js/Node and local vinext/workerd. In production, oEmbed returned HTTP 200 and NDJSON progress arrived promptly. YouTube's watch page returned HTTP 200 with an Innertube API key, but its player endpoint returned HTTP 200 with `LOGIN_REQUIRED` and `Sign in to confirm you’re not a bot`. There were no caption tracks. A standalone deployed Worker reproduced the same response. The failure occurred before segmentation and before mounting the IFrame player, in about one second with no abort. Increasing the 23-second timeout or retrying the blocked request would not fix it.

`youtube-transcript-plus` uses native fetch hooks; the same adapter runs in local workerd. Its generic missing-transcript exception had obscured the explicit bot response. The adapter now inspects player/HTTP responses before library interpretation and distinguishes content errors from infrastructure errors.

## Deployed architecture

```text
Browser → POST /api/prepare (shadowing Worker)
                  ↓
          configured relay provider
                  ↓ authenticated HTTPS
        shadowing-caption-relay Worker
                  ↓ one SQLite Durable Object, hibernating WebSocket
        Node caption host (outbound connection only)
                  ↓ youtube-transcript-plus, no retries
                 YouTube
                  ↓ normalized cues
         segmentTranscript in app Worker
                  ↓ NDJSON lesson → localStorage → /practice/[id]
```

The broker uses constant-time bearer-token authentication on all endpoints, one host connection, at most two pending requests, an 11-second deadline, cancellation messages, and bounded request/reply sizes. The Node host uses a 10-second caption deadline, at most two active requests and an in-memory 50-video cache with a one-hour TTL. Only connection reconnection uses backoff; blocked YouTube caption requests are not retried. Hibernating WebSocket ping/pong avoids holding the Durable Object awake while idle. SQLite Durable Objects are available on Cloudflare's [Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/); normal platform usage limits still apply.

The app prefers the relay when both server settings exist. One direct provider attempt follows only a relay infrastructure error. Missing Japanese captions/private videos are terminal. Each provider returns normalized cues/metadata and lesson provenance; UI/player code contains no provider logic. Signed caption URLs, cookies and internal stacks are not sent to the browser. Workers fetch supports `manual` redirects; the adapter rejects redirects instead of forwarding the secret. The app enables [`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public) so HTTPS calls to the broker's `workers.dev` endpoint reach that Worker rather than bypassing Worker routing.

## Setup and deployment

Use Node 24 and `npm ci`. Sign in with `npx cf auth login`. Generate a random secret of at least 32 characters (for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`) and keep it out of Git.

Create an ignored `.env.caption-relay` on the host:

```dotenv
YOUTUBE_CAPTION_RELAY_URL=https://shadowing-caption-relay.julianpopovskijones.workers.dev
YOUTUBE_CAPTION_RELAY_TOKEN=<same random secret>
```

For initial deployment, create ignored secret JSON files with actual values: `artifacts/relay-secrets.json` contains `{ "YOUTUBE_CAPTION_RELAY_TOKEN": "..." }`; `artifacts/app-deploy-secrets.json` contains that token and `YOUTUBE_CAPTION_RELAY_URL`. The CLI `--secrets-file` format uses string values.

```sh
npm run build:caption-relay
npm run deploy:caption-relay -- --secrets-file ../../artifacts/relay-secrets.json
npm run caption-relay
```

The host makes an outbound WSS connection. It does not need an inbound port, public IP, browser cookies, or a tunnel. Use a service manager on an always-on host to supervise `npm run caption-relay`; a terminal invocation stops when its process exits. A new host connection replaces the old one.

Build/deploy the app after setting its secrets:

```sh
npm run build:vinext
npx cf deploy --prebuilt --mode production --secrets-file artifacts/app-deploy-secrets.json
```

This uses the same vinext/Vite build output and Cloudflare configuration as `npx @vinext/cloudflare deploy --skip-build`. After the initial secrets are installed, normal subsequent deployments use:

```sh
npm run build:caption-relay
npm run deploy:caption-relay
npm run build:vinext
npx @vinext/cloudflare deploy --skip-build
```

The repository does not contain the secret files. For rotation, redeploy the broker and app with the new token and restart the host with the matching token. These server settings are never `NEXT_PUBLIC_` variables.

## Health and verification

With the host's environment file installed, check the broker without printing the secret:

```sh
node --env-file=.env.caption-relay --input-type=module -e "const r=await fetch(new URL('/health',process.env.YOUTUBE_CAPTION_RELAY_URL),{headers:{Authorization:'Bearer '+process.env.YOUTUBE_CAPTION_RELAY_TOKEN}});console.log(r.status,await r.json());"
```

Expect HTTP 200 and `{ connected: true, pending: 0 }`. Without authentication, expect HTTP 401. If the host is offline, `/captions` returns a clean infrastructure error; the app tries its direct provider and still offers transcript import.

```sh
node scripts/check-integrations.mjs http://localhost:3000
node scripts/check-integrations.mjs http://localhost:3001
node scripts/check-integrations.mjs https://shadowing.julianpopovskijones.workers.dev
node scripts/check-youtube-browser.mjs https://shadowing.julianpopovskijones.workers.dev IJ6R4u05ppw
node scripts/check-youtube-browser.mjs https://shadowing.julianpopovskijones.workers.dev KJblreFQ2R8
```

The scripts save ignored reports/screenshots under `artifacts/`. Browser verification uses real network requests and the official player. To verify manual YouTube import, append an integration report containing the video's lesson as the fourth argument to the browser command. Test `jNQXAC9IVRw` for a playable video with no Japanese track and `aaaaaaaaaaa` for an unavailable video; these are external fixtures and can change.

Preparation still streams `identify`, `captions`, `segment`, `done` events and clean error events. Logs include `preparation.metadata`, `captions.providers`, `captions.upstream`, `captions.fallback`, `preparation.failed`, `preparation.done` and `caption-relay.result`. Exceptions include stage/provider/video ID, name/message, timing and abort state; URLs are redacted. There is no public diagnostic route exposing internal provider responses.

## Operational limitations

The verification host is this Windows computer, running the relay as a hidden background Node process. It has not been installed as a boot service. Sleeping/rebooting it or losing its network disconnects the relay; direct Worker egress remains unreliable. Move the same relay to an always-on host and supervise it before considering production uptime fully resolved. Starting it again uses `npm run caption-relay`; stop only its Node process, not unrelated Node processes.

YouTube retrieval remains unofficial and may change or block the relay host too. Cached captions are memory-only; restarts clear them. The app still supports manual Japanese transcripts, own media, SRT/VTT/JSON, and the demo.

MyMemory translation remains separate and best-effort. Production requests encountered HTTP 429 daily quota exhaustion on shared Worker egress while local translation succeeded. This caption fix does not replace the translation provider. Authored/imported translations and playback work regardless of that quota.

Production demo regression checks exposed a separate static-asset range issue: `/demo.mp4` returned HTTP 200 for byte-range requests and Chrome reported a seekable range of `[0, 0]`. The ASSETS binding omits Content-Length. A small Cloudflare entry wrapper now reads the 1 MB bundled file with a hard 2 MB cap, supplies its length and Accept-Ranges, and serves exact/suffix/open-ended ranges as HTTP 206 (unsatisfiable ranges as 416). Only `/demo.mp4` runs through this adapter; vinext's named response/cache exports are preserved. Increase the cap deliberately if the checked-in demo grows. The media player code is unchanged.

## Verification record (2026-10-03)

App version: `bb78de33-735b-4b95-aacb-6aea27e5ad6b`. Broker version: `010b579d-2558-472d-a10d-7ea77eedd113`.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | Pass |
| `npm test` | 21 passing deterministic tests |
| `npm run build`, `npm run build:vinext`, `npm run build:caption-relay` | Pass |
| Existing Playwright suite, local Next.js / deployed Worker | 5/5 pass on each, using installed Chrome |
| Both production Japanese fixture preparations | HTTP 200 NDJSON lessons, relay provider, 252 / 362 sections |
| Both real production YouTube browser checks | Practice navigation, ready player, playback, automatic pause, replay, transcript navigation and persistence pass |
| Manual YouTube transcript import | Real embedded playback/pause/replay/navigation/persistence pass |
| No Japanese captions / unavailable video / invalid input | Distinct `no-japanese-captions` / `video-unavailable` / `invalid-url` results |
| Broker authentication and input bounds | Unauthenticated 401, invalid ID 400, oversized request 413 |
| Bundled demo byte ranges | 206 with correct length/content range; demo browser regression passes |
| Local real translation | HTTP 200 |
| Production real translation | HTTP 503 clean app error, upstream MyMemory HTTP 429 quota exhaustion |

The full production integration script exits nonzero because it checks translation as well as captions. Both caption checks pass. Reports/logs/screenshots are in ignored `artifacts/`; the temporary diagnostic Worker was removed. No player/UI provider logic or post-MVP feature was added.
