import { INTERACTION_WINDOW_MS } from './learner-progress';

export type ClockState = {
  visible: boolean;
  playing: boolean;
  recording: boolean;
  excluded: boolean;
};
// A UI "listening" status alone can survive a stalled media download. Check
// actual adapter time, so buffering cannot keep the active clock running forever.
export class PlaybackActivity {
  private previous: number | null = null;
  sample(time: number, intendedPlaying: boolean) {
    const advanced =
      intendedPlaying &&
      Number.isFinite(time) &&
      this.previous !== null &&
      time > this.previous + 0.01;
    this.previous = intendedPlaying && Number.isFinite(time) ? time : null;
    return advanced;
  }
}
/** Visible playback/recording, 30s after deliberate interaction, or a bounded
 * spoken-response window. No credit for hidden tabs, quizzes or analysis waits.
 * A sampling gap >2s is discarded (sleep/throttled tab); performance.now() is
 * monotonic. Merely opening or restoring the page does not start the clock. */
export class PracticeClock {
  private last: number;
  private activeUntil = 0;
  private state: ClockState = { visible: true, playing: false, recording: false, excluded: false };
  constructor(now: number) {
    this.last = now;
  }
  sample(now: number): number {
    const previous = this.last;
    this.last = now;
    if (now < previous || now - previous > 2000 || !this.state.visible || this.state.excluded)
      return 0;
    const end = this.state.playing || this.state.recording ? now : Math.min(now, this.activeUntil);
    return Math.max(0, end - previous) / 1000;
  }
  update(now: number, patch: Partial<ClockState>) {
    const seconds = this.sample(now);
    this.state = { ...this.state, ...patch };
    return seconds;
  }
  interact(now: number) {
    const seconds = this.sample(now);
    if (this.state.visible && !this.state.excluded)
      this.activeUntil = Math.max(this.activeUntil, now + INTERACTION_WINDOW_MS);
    return seconds;
  }
  spokenResponse(now: number, sectionSeconds: number, speed: number) {
    const seconds = this.sample(now);
    if (this.state.visible && !this.state.excluded)
      this.activeUntil = Math.max(
        this.activeUntil,
        now + Math.min(60000, Math.max(10000, (sectionSeconds / speed) * 2000 + 5000)),
      );
    return seconds;
  }
}
