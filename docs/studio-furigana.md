# Studio Mode and Furigana

Studio Mode changes the visual priority of the existing practice tree. It keeps one media handle, section state, playback mode/speed, bookmark state, recorder and quiz instance. Desktop starts with a wide player (21:9, capped at 42% of viewport height), mode/speed controls, current Japanese section/actions and recording. The full transcript follows, then comprehension/difficulty and supporting information. Tablet/mobile keep 16:9 video and wrap controls at narrow widths. Turning Studio Mode off restores the existing two-column desktop layout.

Both toggles persist only in browser `localStorage` under **`hibiki:v1:preferences`**, using additive boolean fields `studioMode` and `furigana`. `loadPreferences()` treats missing/invalid fields as false, preserves valid mode/speed, and retains the existing section-specific translation-reveal behavior. Toggling either does not command or remount the player, recorder, quiz or difficulty panel.

## Deterministic readings

`JapaneseText` renders the exact source string when disabled. On first enable it dynamically imports the small reading client, which starts a classic browser worker. The worker loads the self-hosted Kuromoji browser build and compressed IPADIC dictionary, then tokenizes locally. There is no LLM, API inference, paid call or third-party network request. Network access to static app assets is needed on first enable unless already browser-cached; normal reading generation needs no service. Plain Japanese remains usable while loading or on failure. Toggle off/on retries unavailable assets.

Kuromoji was chosen over kana transliteration/word splitting because those cannot supply kanji readings. Its morphological dictionary supports contextual selection, common inflection, punctuation and mixed scripts. Unknown tokens receive no invented reading. Known dictionary tokens use their reading (not pronunciation), converted to hiragana. Unique kana alignment keeps okurigana plain; ambiguous alignment uses a whole-word ruby. If token bases cannot reconstruct the exact canonical source, the renderer conservatively keeps that string plain.

Examples produced by the real tokenizer:

```html
<ruby>日本語<rt aria-hidden="true">にほんご</rt></ruby>を<ruby>勉強<rt aria-hidden="true">べんきょう</rt></ruby>しています。
<ruby>今日<rt aria-hidden="true">きょう</rt></ruby>は<ruby>天気<rt aria-hidden="true">てんき</rt></ruby>がいいですね。
<ruby>食<rt aria-hidden="true">た</rt></ruby>べました。
<ruby>大丈夫<rt aria-hidden="true">だいじょうぶ</rt></ruby>です。
```

Ruby has extra line-height and subordinate readings. `rt` is hidden from the accessibility tree to keep accessible names canonical and excluded from selection with CSS. Browser clipboard behavior for partial ruby selections can vary; the base source remains unchanged. No duplicate hidden transcript is rendered. Search continues to match `Segment.japanese` only.

## Assets, compatibility and size

Pinned development dependency **`kuromoji@0.1.2`** provides its published browser build and dictionary. License: Apache-2.0 for the library, with the IPADIC/NAIST/ICOT terms retained in `NOTICE.md`. `esbuild@0.28.2` is a pinned build-tool dependency (already used transitively by the stack). The existing application does not import the Node tokenizer at runtime. The static browser worker uses no Cloudflare bindings or Node APIs.

`npm run furigana:prepare` reproducibly copies assets/licenses and compiles the worker into ignored `public/furigana/v1/`. It runs automatically before the standard Next.js and vinext dev/build scripts. Use the npm scripts when starting/building; invoking `next`/`vite` directly on a clean checkout needs asset preparation first. Next and vinext package the same static files; no files are manually maintained in the generated directory.

Original Furigana release asset costs (client/worker sizes predate the shared-analysis scheduler):

| Asset | Bytes |
| --- | ---: |
| Compressed IPADIC files (sum, already gzip) | 17,791,956 |
| Published browser parser | 307,967 |
| Browser parser, gzip transfer estimate | 67,763 |
| Lazy reading-client chunk, vinext / gzip | 801 / 484 |
| Compiled browser worker | 1,185 |

The dictionary is deliberately **optional and lazy**. Its size is justified by broad morphological coverage on arbitrary imported transcripts instead of a demo-only word list. It is excluded from the initial JavaScript and server Worker bundle. The reading-client chunk is measured separately in build output. Enabling Furigana has a substantial one-time dictionary download and memory cost, especially on low-memory phones; playback stays on the main thread while initialization and tokenization run in the worker.

`analyzeJapanese()` supplies one exact-source morphology result to both public facades, `japaneseReadings()` and `japaneseMorphology()`. Furigana derives its display tokens from that result; topic vocabulary, word coverage, dictionary lookup and Shadowing normalization reuse the same canonical tokenization. Cache identity includes the existing engine/dictionary version. Completed results use LRU eviction with limits of 2,000 entries and 250,000 source UTF-16 units; requests in flight are deduplicated separately and failures are evicted.

`analyzeJapaneseBatch()` retains section IDs and tokenizes each section independently. It sends at most eight sections and 4,096 source UTF-16 units per worker message, yielding between windows; a single longer sentence stays intact in its own message. Only one batch runs at a time, and interactive work takes priority over queued background batches. Abort signals remove unneeded queued work and stop later windows without cancelling another consumer of a shared request. An already-running synchronous tokenization finishes, but its cancelled consumer receives no stale result. The topic overview and active lesson-coverage hook cancel their own work when the lesson is replaced.

A disabled Furigana view does not request readings; other enabled local analysis features can initialize the shared worker. Component cleanup ignores stale results, failures fall back to plain Japanese, and each active worker message has a 60-second timeout. Readings and morphology remain in memory and are never stored in D1 or browser lesson records. Kuromoji/IPADIC remains the shipped engine: the investigated Lindera replacement has not met output-parity and browser-performance gates, so no new WASM engine or deployment toolchain is introduced.

IPADIC is an older dictionary. Proper names, new terms, ambiguous homographs and unusual orthography can be unknown or receive a dictionary reading inappropriate to the context. These are dictionary/parser limitations, not AI-generated guesses. Readings are an aid rather than authoritative pronunciation feedback.

## Identity and verification

Unit tests analyze the real dictionary examples above, check kana/okurigana/punctuation/mixed script/unknown fallback, and compare the complete serialized lesson, `transcriptRevision`, SHA-256 `transcriptKey`, and shared `transcriptHash` before/after annotation. The same quiz revalidates with unchanged exact evidence. Browser tests compare stored lesson/quiz/difficulty/completion artifacts before/after both toggles, and prove kana readings do not enter canonical search.

Playwright covers Studio switching during advancing/paused playback, same media element/time/speed/section, replay/next/previous, older preferences and navigation/reload, bookmarks, recording and recorded A/B audio, retained quiz answers and bounded evidence replay, retry after missing worker assets, ruby in all required surfaces, normal-layout restoration, panel ordering/scrolling, translation hidden/revealed, and long text at 1440, 820, 390 and 320 pixels. Laptop visibility is checked at 1366×768. Screenshots are generated under ignored `artifacts/`; representative desktop/mobile screenshots are retained alongside this document.

Verification results and the exact changed-file list are recorded in the PR. No D1 schema, media adapter, quiz/difficulty generation contract, transcript identity or learner event identity changes are part of this feature.

![Desktop Studio Mode with Furigana](images/studio-desktop.png)

![Mobile Studio Mode with Furigana](images/studio-mobile.png)
