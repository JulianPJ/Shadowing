# Hibiki Discover

Discover implements the coherent P0/P1 feed at `/discover`, using the existing `hibiki` D1 database and `shadowing` Worker. Videos can be browsed and saved before Hibiki has a Japanese transcript. There is one preparation pipeline and one practice player.

## Product and ownership

The warm feed starts with personal recommendations and offers all six existing approximate content bands: N5+, N5–N4, N4–N3, N3–N2, N2–N1 and N1+. For you and All levels include unclassified videos; exact band filters require a validated matching Hibiki estimate. Text, topic, duration, measured speech speed, caption evidence, content orientation, sort and variety combine in one query. Filters survive reload/browser navigation and have individual removal and Clear all. Mobile has horizontal level chips and a native-dialog advanced-filter sheet.

Cards show actual provider thumbnails, channels, duration, coarse topics and truthful ranking explanations. Estimates say Approximately; unknown levels remain unknown. YouTube's caption flag reports captions without verifying their language. Japanese prepared in Hibiki requires an eligible public provider transcript. Orientation filters abstain without independently recorded evidence. Empty lanes are hidden; saved/completed/seen videos are excluded from recommendation lanes, and cards are deduplicated across lanes and paginated results. General results remain accessible for revisiting. More like this and Not interested support undo. Preferred bands change Discover only, never proficiency records or lesson analyses.

Clicking a card goes to `/prepare?video=<canonical URL>`, which reuses Home with explicit auto-start, shared `prepareLinkedVideo`, existing `/api/prepare`, subtitle-choice dialog and ordinary `/practice/youtube-<id>`. Successful auto-preparation replaces its transitional history entry, so Back returns to Discover without preparing again. A ten-minute account-scoped return marker restores filters, loaded result-page count and scroll after the feed is ready. Ordinary Home prefill remains compatible. Save adds only a canonical link/title to Library > Watch Later, without preparing content.

| Concern | Files |
| --- | --- |
| UI and responsive styles | `src/components/discover/`, `src/app/styles/discover.css` |
| Catalogue, eligibility, contracts | `src/lib/discover/catalog.ts`, `eligibility.ts`, `validation.ts`, `types.ts` |
| Ranking and local vocabulary evidence | `rank.ts`, `vocabulary.ts` |
| Scheduled provider acquisition | `refresh.ts`, `youtube-data-api.ts` |
| APIs and queue merge | `server.ts`, `account-server.ts`, `watch-later.ts` |
| Local preferences/feedback and outbox | `client.ts`, existing `library/client.ts` |
| Explicit preparation | `src/app/prepare/page.tsx`, `src/lib/prepare-client.ts` |

## Feed and recommendation contracts

`GET /api/discover` is an anonymous metadata-only read with normalized query parameters and `public, max-age=60`. The Worker uses a named Cache API cache segmented by Cloudflare country. `POST /api/discover` accepts `{ filters, context, cursor }`, requires same-origin JSON, is bounded at 16 KB and always `no-store`. Account cookies never personalize a public GET. Private bodies enter neither shared caches nor logs.

Responses contain `{ items, lanes, total, hasMore, nextCursor, filters, suggestedBand, catalogueUpdatedAt }`. Cards contain public metadata and optional transcript identity/version proof, never transcript text or lesson blobs. One bounded D1 join reads the latest 1,000 fresh candidates; pages contain 24 results. Opaque cursors bind filters, bounded aggregate context, region, catalogue revision and hourly ranking epoch. Changed inputs expire the cursor; the UI offers a fresh retry.

Explainable ranking uses content-band proximity, chosen topics, catalogue topics from saved/completed/liked Hibiki videos, typical completed-session duration, freshness, prepared captions and repeat avoidance. Balanced/wide variety interleaves channels/topics without deleting candidates. Newest and shortest preserve requested ordering. Trending uses aggregated Hibiki activity, never YouTube engagement statistics. Recommended, Easy listening, Stretch, 5–10 minutes, chosen topic, New discoveries and Trending lanes appear when eligible candidates exist.

The browser sends bounded video-ID sets and coarse preferences. Anonymous history stays on the device. Suggestions require multiple completed analyzed lessons and do not certify JLPT proficiency. When enough explicit word states exist, lazy local refinement checks up to eight available lessons with exact matching public transcript proof (500 sections / 20,000 characters each). Only aggregate Known percentages leave the browser, without Japanese text or word records. Missing assets/evidence leave the fast first feed intact.

Classification stays in `generated_artifacts`. Scheduled verification checks eligible system/provider Japanese captions, cue/segmented hashes and the current validated full-coverage difficulty artifact, storing only a reference in `discovery_video_state`. Feed reads require matching hashes, generator version and public trust. Invalid artifacts yield unknown band/speed. Discovery starts no inference, including during ingestion; ordinary practice can populate cached analyses through the existing Workers AI flow.

## Catalogue and schedule

Additive migration `0012_video_discovery.sql` creates catalogue, seed schedule, observed preparation state, account preferences, synced Watch Later, feedback, events/aggregates, lease and quota tables. It copies no transcripts or lessons. Account records cascade on account deletion. Watch Later has no catalogue foreign key, so saved links survive expired/removed provider metadata.

The `*/15 * * * *` trigger runs every 15 minutes with a 15-minute D1 lease. Each execution performs at most two stale-metadata batches of 50 IDs and two Japanese-oriented seeded searches. Seeds have a one-hour cooldown and oldest-run-first rotation; existing 24-hour seed schedules automatically adopt the new cooldown. Search ordering rotates hourly between relevance, newest and most viewed. `videos.list` separately validates search results. Atomic reservations enforce a conservative 9,000-point daily budget before calls (100 internal points per search, one per metadata batch), including failed attempts. Search allowance is released gradually through the Pacific local-clock day, leaving one point to validate results; stale metadata can use the full allowance independently. Quota days reset at midnight `America/Los_Angeles`, including daylight saving. Acquisition has no public endpoint and never runs on feed requests.

[Google's current quota documentation](https://developers.google.com/youtube/v3/determine_quota_cost) lists 100 search calls/day separately from 10,000 daily units for other endpoints. The internal weighted budget conservatively allows roughly 89 search calls plus metadata checks per day, leaving search headroom; it is not a claim that these are one shared Google quota pool. Verify the actual project's quotas and other consumers before release. Bounded provider failures stop acquisition for the invocation while cached browsing, saving, practice and independent maintenance continue. A late initial deployment or provider outage may use less than the budget: useful acquisition takes priority over spending every available point.

The adapter uses fixed official Google endpoints, allowlisted parameters, a server-only API-key header, 10-second requests, a 512 KB response bound and no followed redirects. It rejects private/unembeddable/live/age-restricted/invalid entries, constrains duration and thumbnail hosts, and retains reported country restrictions. Titles do not determine level/speed/orientation. Topic tags are coarse query-seed labels, not verified semantic classification.

Metadata older than 24 hours becomes refreshable and expires after seven days. Validation removes missing/private/deleted IDs. Purge runs even without a key or available quota. Upstream failure leaves independent artifact verification and aggregation running. Server-observed preparation outcomes affect only catalogued IDs: unavailable content receives a 15-minute cooldown, absent captions stay visible with an own-subtitles hint, and network failure never permanently bans a card. Region/playback restrictions remain best effort and are confirmed at preparation/player time.

## Accounts, offline behavior and privacy

New account APIs reuse Better Auth, same-origin JSON checks, verified-email mutations and `X-Hibiki-Account` ownership fencing. They are `no-store`. The separate Discovery limiter permits 90 requests per minute per IP without consuming the six-per-minute AI budget.

| Endpoint | Behavior |
| --- | --- |
| `GET/PATCH /api/discover/preferences` | Strict band/topics/duration/variety; latest accepted PATCH wins |
| `GET/POST /api/discover/feedback` | Account-owned latest feedback; reset supports undo; server receipt orders writes |
| `GET/POST /api/watch-later` | Read records; idempotently save an ID or merge up to 120 records per write |
| `DELETE /api/watch-later/<id>` | Timestamped removal without fetching content |
| `POST /api/discover/events` | Up to 24 validated events; cannot write catalogue state |

Existing current-account local queues migrate once. Anonymous saves require Library's explicit **Add this device's anonymous saves to my account** action. Sign-in never infers consent. Namespaces remain isolated across account changes/logout. Vimeo/direct links retain local behavior; cross-device Watch Later covers canonical YouTube links. Device-only media reserve places in the 40-link local view; any additional account saves remain in records/D1, with a visible overflow count, and appear when a local place is freed.

Records keep original added time, edit time, position and deletion tombstones. Newer edits win; deletion wins an exact-time tie, followed by deterministic title/position ties consistent between SQL/browser. Order is position, added time and ID. Future edits beyond five minutes are rejected. D1 enforces 40 active links across a batch; excess concurrent additions show an actionable conflict. Removals replay before replacements. Large offline outboxes use 120-record batches and clear only exact accepted versions, retaining in-flight edits.

Local edits are immediate, including blocked storage with a visit-only notice. Reconnection, focus and Sync now retry the outbox. Awaited responses check identity before hydrating/clearing writes; learner-profile hydration discards old-account work too. Discover joins aggregate account sync status, so a failed queue/preference/feedback channel cannot claim everything is synced.

Deletion tombstones and feedback expire after 180 days; reconciliation for a device offline beyond that horizon is best effort. Raw signed-in events and aggregates expire after 30 days. Events are unique per learner/day/video/action. Prepared/save/complete events require corresponding server evidence. Completion events use the actual saved practice day and reject out-of-retention history, so reconnecting cannot inflate current popularity. Popularity is exposed only for video/day cohorts of ten distinct authenticated learners. Anonymous visitors produce no server browsing-event records. Safe logs include candidate/eligible counts, latency, refresh counts and quota/provider codes, never tokens, private text or learner history.

## Release and rollback

This implementation does not deploy production or apply production SQL. Release in order:

1. Set `YOUTUBE_DATA_API_KEY` on the existing Worker via its cf CLI/dashboard and enable YouTube Data API for the key. Keep it server-only and out of Git/chat. Retain existing caption, AI and account bindings.
2. Apply `npm run db:migrate:production` and confirm `npm run db:migrations:production` reports no pending migrations. Never reset D1.
3. Build with `npm run build`; release through the `npm run deploy` migration gate. Verify the cron and `discover.refresh` logs/quota/catalogue freshness after initial runs.
4. Smoke-test actual metadata, anonymous/account saves and a known-caption preparation in the deployed browser. Verify real analyzed-content filters. New metadata results correctly start unclassified. Live ingestion, existing caption-relay/AI and authenticated cross-device smoke checks remain release checks.

`DISCOVER_ENABLED=false` disables the Worker route, feed APIs and scheduled acquisition. `NEXT_PUBLIC_DISCOVER_ENABLED=false` hides navigation at rebuild. Practice/Library and saved queue data remain available; rollback retains additive tables. Seed rows can be disabled without removing saves. Change cadence/budget through a code release if monitoring warrants it.

Local workerd/D1 checks need no live key; `npm run dev` reads an explicitly populated local catalogue and otherwise reports awaiting configuration. A local YouTube key never initiates request-time searches; scheduled acquisition belongs to the Cloudflare Worker.

## Verification

Fixtures use fictional IDs and mocked provider boundaries without spending YouTube/AI quota. `tests/discover.test.ts` covers bands, abstention, filter/freshness/region bounds, ranking/diversity, cursor integrity, provider envelopes, merge ties and preparation transport. `tests/discover-d1.test.ts` applies all twelve migrations to real local D1 and verifies metadata-only reads, public artifact trust, quota/purge, ownership, capacity/replacement and privacy cohorts. `tests/e2e/discover.spec.ts` covers desktop/mobile, blocked storage, filters/back/reload, pagination, save/undo/Library, preference/feedback, card-to-practice, missing captions, account offline/reconnect and explicit anonymous import. The built Worker check verifies new routes and unchanged caption/AI counts beside existing caches.

Run typecheck, lint, formatting, unit tests, the build, `test:d1:migrations`, `test:d1:runtime` and Playwright. See [architecture](architecture.md) for commands.

### Refresh-budget follow-up — 9 October 2026

The 15-minute schedule and higher weighted budget need a code deployment only; migration `0012` is unchanged. Real D1 tests simulate an entire Pacific day, check near-budget acquisition and topic/order variety, deny exhausted-quota network calls, allow final-point stale metadata refresh, adopt existing seed schedules and test summer/winter/DST reset boundaries. The follow-up does not apply production SQL or deploy a Worker.
