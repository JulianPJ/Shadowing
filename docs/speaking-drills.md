# Speaking diagnostics and deliberate drills (Phase C)

Hibiki keeps Listen → pause → speak → compare as the primary practice loop. The speaking additions borrow explicit presets from intensive viewing tools and make the existing recognition match useful without introducing phoneme, pitch-accent or authoritative pronunciation grades.

## Score and evidence

`shadowing-score.ts` still computes score version 1: 80% recognized-text alignment and 20% overall duration similarity, with exactly the existing normalization, alignment, rejection limits, pace bands and timing tolerance. Diagnostics group consecutive existing alignment operations for display. They show Matched, Not heard, Heard differently and Extra heard chunks, using dictionary readings when local readings are available and normalized written text otherwise. The source sentence and the recognized sentence stay visible. These are recognizer observations; substitutions can reflect recognition mistakes.

The pacing line shows the recognized speech window in seconds and the source section duration at the selected playback speed, followed by the overall duration difference. It does not measure within-sentence rhythm, individual sound timing or pitch. The explicit Analyse attempt action, Pro gate, microphone upload consent and current transcription/feedback providers remain in place. Hands-free recording never automatically uploads or scores audio.

## Presets and controls

All four names appear in the Practice preset selector:

| Preset | Source plays | Pause | Translation |
| --- | --- | --- | --- |
| Focus | 1 | Until Continue | On request |
| Support | 1 | Until Continue | Revealed after the completed source plays |
| Drill | 2 | Until Continue | On request |
| Continuous | Whole media | No section pause | On request |

Source repeats can be changed to 1, 2 or 3. Pause can be Until I continue or Timed speaking window. Translation can be Reveal on request or Reveal after source repeats. The speaking window is an explicit 2–30 seconds, default 5; there is no timing compensation inferred from speech or hidden extra pause. Repeat and section-boundary timing use the existing media adapter, polling tolerances and explicit playback offset. Continuous disables the section-only controls.

Selecting a preset hides the current translation. Existing explicit per-section translation visibility continues to restore on reload, preserving the earlier player contract.

Manual pause remains the default. With a timed window, the player pauses after all selected source plays, gives exactly the displayed speaking window, then moves to the next authored section. Stop timed practice pauses playback, cancels continuation and returns the visible Pause setting to manual.

Drill also exposes Start hands-free drill. That explicit action requests microphone permission before playing the source. After all selected source plays, Hibiki records locally for the displayed speaking window, stops recording, and continues to the next authored section. At the last section it finishes once. Recordings are still in memory and are cleared on section change, so learners who want to listen back or analyse an attempt should stop the hands-free drill before continuing. Stop hands-free drill pauses playback and ends recording. The normal manual Record yourself and Analyse attempt flow remains available. Permission denial leaves manual playback usable.

Navigation, source replay, speed/offset/preset changes, quiz/evidence replay, hidden tabs, account changes, playback failures and unmount invalidate pending automation and microphone requests. Manual recording and recording playback cancel timed continuation. A generation guard prevents the polling boundary and native ended event from completing the same section twice. Late microphone responses stop their tracks and cannot start an interrupted drill.

## Recent section trend and persistence

The latest full analysis remains in the existing current-tab `hibiki:shadowing:v1:` format. Anonymous use retains its existing key; account sessions use an account namespace so analysis text cannot leak across sign-ins. Reloading the same tab preserves the latest result; closing the tab clears its recognized text and detailed alignment.

Compact successful attempt points persist through the account-aware browser storage helper at `shadowing:history`. Each point contains only timestamp, aggregate/content/timing scores, source duration at selected speed and recognized speech duration. The durable record uses a bounded local 128-bit revision fingerprint rather than retaining the transcript string. This is a local history identity, not an authentication or canonical cryptographic content hash. Canonical transcript hash semantics are unchanged.

Limits are eight recent successful attempts per section, 200 recently scored sections per transcript revision, 24 recently updated revisions and 1 MiB of encoded history total. Oldest revisions leave first when the byte bound is reached. Failed attempts never replace scores or add trend points. The storage helper keeps current-visit data in memory on failed writes and emits the existing storage warning.

The recent-score sequence is available even after the latest full analysis has left session storage. Its comparison uses only attempts at the same source duration/playback speed as the latest point and compares the first and latest of those retained points. One attempt, or attempts only at different speeds, gets an explicit insufficient-comparison message. This is a recent practice observation, not a claim of stable long-term improvement.

`loadAllShadowingSessions()` supplies validated compact history to the weekly report. Its `transcriptRevision` values are local fingerprints; `compactShadowingRevision(transcriptRevision(lesson))` resolves a matching locally available revision. `aggregateShadowingScores()` continues to use one latest valid scored attempt per section in the active tab and excludes unattempted sections.

## Verification

- `tests/shadowing-score.test.ts` retains score/calibration, aggregation and failure behavior checks.
- `tests/speaking-drills.test.ts` covers preset defaults and malformed settings, exact chunk grouping without alignment mutation, eight-point retention, tab loss, revision/account isolation, same-speed comparisons, malformed persisted evidence and revision/byte bounds.
- `tests/e2e/speaking-drills.spec.ts` exercises real media boundaries and real MediaRecorder with browser microphone fixtures: repeat twice, Support reveal timing, timed continuation and stop/navigation cancellation, opt-in hands-free recording and interruption, recognized omissions/pacing with persistent history, microphone denial and final boundary deduplication.
- Existing `tests/e2e/shadowing.spec.ts` continues to exercise the original player, recording, explicit scoring, completion and local media path.

Browser transcription and feedback use deterministic fixtures; these tests verify the complete browser flow and request boundary without claiming live speech-recognizer quality. Provider calibration remains separate validation work.
