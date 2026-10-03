# Project Context — Hibiki / Shadowing

> **Purpose:** persistent product and engineering context for future development.
>
> **Current snapshot:** 2026-10-03, based on `main` at commit `b7892366429880b6214b850ef64e9cabce749e22`.
>
> **Deployment target:** Cloudflare Workers via vinext. Cloudflare is the canonical hosted environment for this project; do not assume Vercel.

## 1. Product purpose

Hibiki is a Japanese listening and speaking practice app built around **shadowing**.

Traditional shadowing asks a learner to listen to native speech and repeat it while the source keeps moving. That is useful, but mechanically difficult: the learner has to keep up, manually seek backwards, remember what was said, and decide when to pause.

Hibiki removes that friction. It turns timestamped Japanese speech into short, natural sections and provides a deliberate practice loop:

**listen → pause → say it back → replay/compare → continue**

The learner should be able to use Japanese content they genuinely want to watch or listen to rather than being restricted to a closed lesson catalogue.

The app should encourage direct comprehension of Japanese. Japanese text remains visible while English translation is hidden until the learner asks for it.

## 2. Product vision

The near-term product is a **shadowing-first player for authentic Japanese media**.

The longer-term vision is:

> **Turn Japanese media into an interactive speaking, comprehension, and review lesson.**

The ideal learning loop becomes:

**Consume → Shadow → Understand → Test → Review → Retain**

Long term, Hibiki should act as a learning layer over Japanese media rather than becoming a generic AI tutor or a generic video transcription product.

The app should eventually understand useful learner signals such as:

- which sections were replayed repeatedly;
- where translations were revealed;
- which words were looked up;
- which comprehension questions were missed;
- which sections were bookmarked or explicitly marked difficult;
- which recordings required repeated attempts;
- which grammar/vocabulary patterns recur in difficult material;
- how difficult different content appears to be for the learner.

Those signals should feed directly back into better practice: weak-section review, useful vocabulary review, adaptive comprehension questions, and eventually pronunciation feedback.

## 3. Product principles

### Shadowing stays central

New features should make authentic-media shadowing more effective. Do not let quizzes, vocabulary tooling, AI chat, gamification, or dashboards displace the primary listen/pause/repeat loop.

### Japanese-first

The architecture may eventually support more languages, but product decisions should optimize for Japanese learners first.

### Authentic content over a closed catalogue

The learner should be able to bring content they already care about. YouTube is the first major source, not the permanent boundary of the product.

### Reveal help when needed

Translation and explanations should be available without becoming the default experience. The learner should first have the chance to understand Japanese directly.

### Context is valuable

Vocabulary, grammar, questions, and review should stay connected to the original media, transcript sentence, timestamp, and speaker audio whenever possible.

### Prefer useful feedback over fake precision

Do not present crude speech-to-text similarity as authoritative pronunciation scoring. A/B listening, recognized-text comparison, and specific qualitative feedback are better than a meaningless score.

### Graceful fallback is part of the product

External services can fail. The app should remain demonstrable and useful through imported subtitles, own media, and the bundled demo rather than becoming unusable when one provider fails.

### Keep infrastructure proportionate

The app began as a personal learning tool. Avoid authentication, complex databases, queues, paid AI dependencies, or large infrastructure until a product requirement justifies them.

## 4. Current implementation

The repository already contains a substantial working MVP rather than scaffolding.

### Home / lesson preparation

The home page currently supports:

- a Japanese YouTube URL;
- a bundled demo lesson;
- importing YouTube plus user-provided subtitles;
- importing local audio/video plus subtitles;
- recent lessons saved on the current device;
- streamed preparation progress and recoverable error states.

The main YouTube preparation path is:

`src/components/home.tsx`
→ `POST /api/prepare`
→ `youtubeCaptions.transcribe(...)`
→ `segmentTranscript(...)`
→ save lesson in browser storage
→ navigate to `/practice/[id]`.

### Shadowing player

The practice experience already includes:

- Shadowing and Continuous modes;
- automatic pause at segment boundaries;
- replay;
- previous/next;
- click-to-seek transcript rows;
- active transcript following;
- playback speed controls: 0.5×, 0.75×, 1×, 1.25×;
- translation reveal/hide;
- section and lesson progress;
- keyboard shortcuts;
- transcript search;
- bookmarks / saved-section filtering;
- responsive desktop/mobile UI;
- persistence of lesson position and preferences.

### Voice recording

Basic learner recording is already implemented with browser `MediaRecorder`:

- record the learner's attempt;
- replay it;
- switch back to source audio for A/B comparison;
- recordings remain local/in-memory and are not uploaded;
- microphone denial degrades gracefully.

This means future pronunciation work should build on the existing recording flow rather than replacing it.

### Media playback

`src/components/media-player.tsx` provides two playback paths:

1. **YouTube:** official IFrame Player API, using `youtube-nocookie.com`, an explicit `origin`, playback controls, retries, and player error handling.
2. **Local/demo media:** browser `<video>` playback.

YouTube timing is inherently less precise than direct HTML media. The player currently checks shadowing boundaries frequently and pauses hidden-tab shadowing to reduce timer-throttling overshoot.

### Transcript acquisition

Current transcript sources are:

- YouTube Japanese captions through `youtube-transcript-plus`;
- imported SRT;
- imported WebVTT;
- imported JSON;
- pasted timestamped transcript text;
- optional local Whisper/faster-whisper for the learner's own media.

Current import support does **not** yet include ASS/SSA.

### Segmentation

`src/lib/segmentation.ts` normalizes and segments timestamped cues into useful shadowing sections. It handles punctuation, pauses, rolling captions, overlaps, validation, and proportional timing estimates when a cue is split.

Typical target length is roughly 2–8 seconds, but natural language boundaries take priority.

### Translation

English is lazy and hidden by default.

Current automatic translation uses MyMemory through `/api/translate`. Results are cached in the browser and in a small server-memory cache. Imported/authored translations bypass the external service.

This provider is free/keyless but quota and quality are not guaranteed.

### Persistence

Current progress is browser-local:

- lesson data;
- recent history;
- last section;
- mode;
- playback speed;
- translation visibility;
- bookmarks;
- translation cache.

There is no account system, hosted user database, or cross-device sync.

### Demo

A bundled original Japanese demo is available independently of external services. It includes synthetic Japanese speech, authored translations, media, and timestamps.

This is important and should remain: the product must always have a deterministic way to demonstrate the core shadowing UX.

### Testing

The repository includes:

- unit tests for segmentation/subtitle behavior;
- Playwright end-to-end tests for the core demo flow;
- microphone success/denial coverage;
- local media/subtitle import coverage;
- mobile/layout checks;
- integration-check tooling for real caption/translation services.

`scripts/check-integrations.mjs [base-url]` can exercise `/api/prepare` and `/api/translate` against either localhost or a hosted deployment.

## 5. Current technical architecture

Current stack:

- Next.js 16 App Router;
- React 19;
- TypeScript;
- authored CSS;
- Lucide icons;
- Cloudflare Workers deployment via vinext/Vite;
- Workers Cache adapter for page responses;
- browser `localStorage` for practice persistence.

Important files:

| Location | Responsibility |
| --- | --- |
| `src/components/home.tsx` | URL preparation, progress, demo, recent lessons |
| `src/components/practice.tsx` | practice state, segment navigation, boundaries, transcript, bookmarks, translation |
| `src/components/media-player.tsx` | YouTube and HTML-media playback adapter |
| `src/components/voice-recorder.tsx` | MediaRecorder flow and A/B listening |
| `src/components/import-dialog.tsx` | YouTube + subtitles and own-media import |
| `src/lib/types.ts` | Lesson/segment/provider contracts |
| `src/lib/segmentation.ts` | transcript cleanup and shadowing segmentation |
| `src/lib/subtitles.ts` | SRT/VTT/JSON parsing |
| `src/lib/providers/transcription.ts` | YouTube and imported transcript providers |
| `src/lib/providers/translation.ts` | translation provider |
| `src/lib/storage.ts` | local persistence |
| `src/app/api/prepare/route.ts` | streamed YouTube preparation route |
| `src/app/api/translate/route.ts` | lazy translation route |
| `cloudflare.config.ts` | Cloudflare Worker definition |
| `vite.config.ts` | vinext + Cloudflare build integration |
| `scripts/check-integrations.mjs` | real hosted/local integration smoke check |

## 6. Hosting: Cloudflare is canonical

The hosted app uses **Cloudflare Workers**, not Vercel.

Current deployment path:

- `npm run build:vinext`
- `npx @vinext/cloudflare deploy --skip-build`

The app is packaged as one Worker. It currently requires no R2 bucket, Durable Object, external database, or separate cache Worker.

The Cloudflare compatibility flag `nodejs_compat` is enabled.

When diagnosing a bug that occurs only after deployment, reproduce it in the actual Cloudflare Workers runtime rather than assuming behavior from `next dev` or a conventional Node server is representative.

---

# 7. P0 — TOP PRIORITY: deployed YouTube preparation is broken

## Status

**This is the first issue future development should address before adding post-MVP features.**

Observed production environment:

`https://shadowing.julianpopovskijones.workers.dev/`

Observed behavior from the production screenshot:

1. A valid YouTube URL is submitted.
2. The app attempts to prepare it.
3. The request ends with:

> “We couldn’t get Japanese captions for this video. Captions may be missing, or YouTube may be limiting access. Import a timestamped transcript to practice this video, or try the demo.”

The screenshot used:

`https://www.youtube.com/watch?v=KJblreFQ2R8`

The same general YouTube path is reported to work locally.

## Important distinction

The current UI does not navigate to the practice player until transcript preparation succeeds.

Therefore, although the user-visible symptom is “YouTube videos do not load in production,” the screenshot shows a failure during **server-side preparation/caption acquisition**, before the YouTube IFrame player is mounted.

Do not initially assume this is a YouTube IFrame embed problem.

The likely failing path is:

`/api/prepare`
→ `youtubeCaptions.transcribe(videoId)`
→ `youtube-transcript-plus.fetchTranscript(...)`.

That hypothesis must be confirmed with Cloudflare Worker logs and direct integration checks.

## Why it matters

YouTube is currently the lowest-friction primary entry point. If deployed users cannot turn a YouTube link into a lesson, the main product promise is broken even though the demo and manual subtitle import still work.

Treat this as **P0 / release-blocking**.

## Required investigation

Start by comparing the same known-captioned video across runtimes.

Run:

```sh
node scripts/check-integrations.mjs http://localhost:3000
node scripts/check-integrations.mjs https://shadowing.julianpopovskijones.workers.dev
```

Also test the original integration video already referenced by the repository:

`https://www.youtube.com/watch?v=IJ6R4u05ppw`

Then:

1. inspect Cloudflare Worker logs for the `/api/prepare` request;
2. temporarily improve server-side diagnostics so the actual provider exception name/message and failing stage are visible in logs without exposing internals to users;
3. verify whether YouTube oEmbed succeeds from the Worker;
4. verify whether `youtube-transcript-plus` itself can execute correctly in the Workers runtime;
5. determine whether the failure is runtime incompatibility or YouTube limiting/blocking requests from Cloudflare egress IPs;
6. verify `AbortSignal.any`, timeouts, and streamed NDJSON behavior under the deployed vinext Worker;
7. compare a captioned video, a video with no Japanese captions, and an unavailable/private video so the app can distinguish real content errors from provider/runtime errors.

## Plausible causes to test, not assume

- `youtube-transcript-plus` may rely on Node/runtime behavior that differs under Workers despite `nodejs_compat`;
- YouTube may be throttling or rejecting requests from Cloudflare Worker egress;
- the unofficial caption retrieval flow may depend on headers/cookies/request behavior that differs in production;
- vinext/Workers streaming or cancellation behavior may expose a bug that local Next.js does not;
- a dependency may bundle differently for the Worker runtime.

Do not “fix” this by blindly increasing retries. If YouTube is explicitly limiting datacenter/Worker traffic, repeated retries will make reliability worse.

## Acceptance criteria for P0

The issue is not resolved until:

- a known Japanese-captioned YouTube video can be submitted on the deployed Cloudflare URL;
- `/api/prepare` returns a valid lesson;
- the app reaches `/practice/[id]`;
- the YouTube player initializes and plays;
- shadowing boundaries/replay work against the deployed app;
- expected “no Japanese captions” cases are distinguishable from infrastructure/provider failures;
- the manual subtitle-import fallback remains available;
- the hosted integration check is documented and easy to repeat.

If reliable automatic YouTube caption retrieval cannot be made robust from Cloudflare Workers, keep the core UX and change the provider strategy rather than coupling the whole product to an unreliable unofficial request path.

---

# 8. Architectural direction before broader media support

The current `Lesson` model uses:

`source: 'demo' | 'youtube' | 'upload'`

That is sufficient for the MVP but will become restrictive as media/transcript options grow.

Before implementing custom embeds or several new content sources, evolve the model toward separate concepts:

```ts
interface MediaSource {
  type: 'youtube' | 'local' | 'direct' | 'embed';
  // provider-specific fields
}

interface TranscriptSource {
  type: 'youtube-captions' | 'ass' | 'ssa' | 'srt' | 'vtt' | 'json' | 'generated';
}
```

The shadowing player should consume normalized media controls plus normalized timestamped segments. It should not care how the transcript was acquired.

Conceptually:

```text
MediaSource + TranscriptSource
            ↓
    Normalized lesson
            ↓
      Shadowing player
            ↓
Quiz / vocabulary / grammar / review
```

This separation is important for the post-MVP roadmap.

---

# 9. Post-MVP roadmap

Do not begin these in earnest until P0 production YouTube reliability is understood.

## Phase 1 — Content-source extensibility

This is a high-value expansion because serious learners often already have Japanese subtitle files.

### ASS / SSA support

Add subtitle parsing for:

- `.ass`
- `.ssa`

For the first version, extract:

- start time;
- end time;
- visible dialogue text.

Strip ASS styling/positioning overrides that are irrelevant to shadowing.

Do not attempt to preserve all ASS layout semantics initially.

### Subtitle offset / synchronization

Imported subtitles and media are often slightly misaligned.

Add a saved per-lesson global offset, for example:

`-0.5s | Reset | +0.5s`

All effective segment times should use the offset without modifying the source file.

### Bilingual subtitle tracks

Allow a Japanese subtitle file and an English subtitle file to be loaded together.

Align translations by timestamp overlap/fuzzy timing rather than assuming cue indexes match exactly.

This can provide high-quality translation without an AI/API call.

### Direct media URLs

Support browser-playable direct media where practical (for example MP4/WebM and suitable HLS support).

### Custom embeds

Treat custom websites/providers as explicit playback adapters.

Do **not** promise “paste any streaming website.” Arbitrary iframes may be blocked by CSP/X-Frame-Options and cross-origin JavaScript cannot generally control a third-party player.

A provider should only be supported when it can legally/technically be embedded and exposes sufficient playback control (seek, play, pause, current time).

Local media already exists and should remain a first-class privacy/cost-friendly path.

## Phase 2 — Post-video comprehension test

After completing a video, offer a short multiple-choice test generated from the transcript.

Each question should contain structured grounding:

```ts
{
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  evidenceStart: number;
  evidenceEnd: number;
  type: string;
  difficulty: string;
}
```

Question types should include:

- main idea;
- detail recall;
- sequence;
- vocabulary in context;
- grammar in context;
- reference resolution;
- speaker intent/attitude;
- reasonable inference.

### Key differentiator: replay evidence

When a learner gets a question wrong, provide:

**Replay relevant section**

The question must therefore be tied to transcript timestamps.

### Test difficulty

Offer:

- Easy;
- Normal;
- Challenge.

Difficulty should change question sophistication, not source content.

Support alternate question generation for retesting so the learner does not simply memorize answer positions.

## Phase 3 — Content difficulty analysis

Estimate learner-oriented difficulty rather than claiming an exact JLPT classification.

Useful output:

- overall estimated range, e.g. N3–N2;
- vocabulary difficulty;
- grammar difficulty;
- speech speed;
- casual-language density;
- sentence complexity.

Potential signals:

- vocabulary frequency / JLPT associations;
- grammar structures;
- sentence length;
- speech rate;
- kanji complexity;
- contractions and omissions;
- slang;
- domain-specific language.

Later distinguish:

- **estimated content level**;
- **estimated difficulty for this learner**.

## Phase 4 — Transcript intelligence

This area can borrow useful interaction ideas from reading-focused apps such as Todaii while keeping Hibiki shadowing-first.

### Tap-to-lookup

Click/tap transcript words to show:

- dictionary form;
- reading;
- meaning;
- part of speech;
- contextual meaning;
- save/known controls.

The learner should not need to leave the player.

### Optional JLPT highlighting

Provide a user-controlled transcript overlay for N5/N4/N3/N2/N1 or uncommon vocabulary.

Keep the default screen calm; do not turn the transcript into a wall of color.

### Vocabulary extraction

After processing a video, identify useful words and expressions.

Every item should stay connected to:

- the original sentence;
- timestamp;
- replayable source audio;
- translation/context.

Prefer useful expressions over mechanically listing every uncommon token.

### Grammar extraction

Identify noteworthy grammar patterns used in the transcript and provide:

- short explanation;
- approximate level;
- exact source sentence;
- translation;
- timestamp;
- replay button.

The value is grammar in authentic spoken context, not generic generated lessons.

## Phase 5 — Weak-section review

Combine learner signals to identify difficult sections.

Signals can include:

- failed comprehension question;
- repeated replays;
- translation reveal;
- bookmark / “difficult” marking;
- repeated voice attempts;
- vocabulary lookup;
- later pronunciation feedback.

Then generate:

**Review weak sections**

Example:

- original video: 18 minutes;
- targeted review: 3 minutes.

The important loop is:

**Watch → Shadow → Test → Detect weakness → Shadow weak sections again**

This should become a defining feature.

## Phase 6 — Saved vocabulary and spaced review

Build lightweight review before attempting a full Anki replacement.

Save:

- word/expression;
- reading;
- meaning;
- original sentence;
- source video/lesson;
- timestamp;
- learning state.

Context-first cards should be able to replay the source audio.

Later add simple spaced repetition for vocabulary, expressions, grammar, difficult sentences, and listening items.

## Phase 7 — Progress and learner model

Once there is enough data, track useful trends:

- minutes shadowed;
- segments completed;
- videos completed;
- quiz performance;
- typical content level;
- playback speed;
- replay frequency;
- translation reveals;
- vocabulary lookups;
- saved sections;
- grammar difficulties;
- voice attempts.

Prefer actionable learning information over decorative gamification.

Eventually use history to estimate **difficulty for this learner**, not just generic content difficulty.

## Phase 8 — Pronunciation feedback

Build incrementally on the existing recorder.

### Stage 1 — already implemented

Manual native-vs-learner A/B listening.

### Stage 2

Transcribe the learner's recording and compare recognized Japanese with the target.

Label this as speech-recognition/content comparison, not pronunciation scoring.

### Stage 3

Provide specific likely problems where confidence is sufficient, such as missing words/morae, long vowels, or timing differences.

### Stage 4

Explore more advanced phoneme, rhythm, timing, and pitch-accent feedback.

Do not ship an authoritative numeric pronunciation score unless the measurement actually justifies it.

## Phase 9 — AI discussion based on the video

After a learner has shadowed/tested a video, offer Japanese conversation about that content.

The conversation should be grounded in:

- transcript;
- summary;
- vocabulary;
- learner level/difficulty.

This should feel like active production connected to the media, not a generic chatbot tab.

---

# 10. Features already implemented — do not re-plan them as future work

Future agents should verify before proposing work. At this snapshot, the following already exist:

- Shadowing vs Continuous playback;
- automatic segment pause;
- replay/previous/next;
- playback speed;
- lazy translation;
- browser voice recording;
- A/B playback;
- transcript search;
- bookmarks/saved-section filtering;
- recent local lessons;
- local progress persistence;
- local own-media import;
- SRT/VTT/JSON transcript import;
- YouTube + user transcript import;
- bundled deterministic demo;
- optional local Whisper;
- responsive/mobile behavior;
- keyboard shortcuts;
- unit and Playwright tests;
- Cloudflare Workers/vinext deployment configuration.

---

# 11. Known constraints / technical debt

### YouTube caption retrieval is unofficial

`youtube-transcript-plus` is currently a critical dependency for the easiest onboarding path but relies on unofficial transcript retrieval. Treat production reliability as a first-class concern.

### Translation service is best-effort

MyMemory is keyless/free and may have quota/quality limits. Translation failure must never block shadowing.

### No durable server data

Progress is local to the current browser/origin. This is intentional for now, but later personalization across devices will require accounts/storage.

### Translation server cache is in-memory

The Worker-side Map is not a durable shared cache. Browser caching is currently more important.

### Local uploaded media is session-bound

Object URLs cannot survive a full refresh. The transcript persists but the learner must reattach the original file.

### Optional Whisper is local-only

The Python faster-whisper service is not part of the hosted Cloudflare app.

### Media/transcript model needs generalization

Before many new providers are added, separate media source from transcript source as described above.

---

# 12. Development priorities

Use this ordering when tradeoffs are necessary:

1. **Production reliability of the core YouTube → lesson path**
2. Shadowing UX and playback/timestamp reliability
3. Transcript quality / segmentation
4. Content-source flexibility and subtitle import
5. Comprehension testing and timestamped review
6. Vocabulary/grammar intelligence
7. Weak-section / retention loop
8. Personalized progress
9. Pronunciation analysis
10. Nice-to-have presentation and gamification

Do not sacrifice the first three for impressive AI features.

---

# 13. Definition of product success

A strong version of Hibiki should make this experience feel effortless:

1. choose Japanese content the learner genuinely wants to consume;
2. turn it into timestamped practice quickly;
3. listen to a natural section;
4. pause automatically;
5. repeat it without fighting the player;
6. compare/replay when needed;
7. reveal help only when necessary;
8. finish the content;
9. test actual understanding;
10. revisit the exact weak moments;
11. retain useful vocabulary/grammar in context;
12. see the next practice session become more personalized.

The long-term moat is not “AI features.” It is the combination of authentic media, timestamped context, frictionless shadowing, learner signals, and targeted review.
