// Vimeo's API is asynchronous. Serialize commands so pause → seek → play cannot race.
// Read actual provider time, never extrapolate across buffering or stalled playback.
export type VimeoControlApi = {
  play(): Promise<void>; pause(): Promise<void>; setCurrentTime(time: number): Promise<number>;
  getCurrentTime(): Promise<number>; setPlaybackRate(speed: number): Promise<number>;
};
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Vimeo control timed out')), 8000); })]); }
  finally { clearTimeout(timer); }
}
export class VimeoControls {
  private chain: Promise<void> = Promise.resolve(); private revision = 0; private polling = false;
  private pending = 0; private seconds = 0; private playing = false; private disposed = false;
  constructor(private api: VimeoControlApi, private fail: () => void, private rateUnavailable: (unavailable: boolean) => void) {}
  private command(operation: () => Promise<unknown>): Promise<void> {
    this.pending++;
    const result = this.chain.then(async () => {
      if (this.disposed) return;
      await bounded(operation());
    }).finally(() => { this.pending--; });
    this.chain = result.catch(() => { if (!this.disposed) this.fail(); });
    return result;
  }
  play() { return this.command(() => this.api.play()); }
  pause() { this.playing = false; void this.command(() => this.api.pause()).catch(() => {}); }
  seek(time: number) {
    const revision = ++this.revision; this.seconds = time;
    void this.command(async () => { const actual = await this.api.setCurrentTime(time); if (!this.disposed && revision === this.revision) this.seconds = actual; }).catch(() => {});
  }
  time() { return this.seconds; }
  isPlaying() { return this.playing; }
  playingState(value: boolean) { this.playing = value; }
  setSpeed(speed: number) {
    void this.command(async () => {
      try { await this.api.setPlaybackRate(speed); if (!this.disposed) this.rateUnavailable(false); }
      catch { if (!this.disposed) this.rateUnavailable(true); }
    }).catch(() => {});
  }
  async poll() {
    if (this.disposed || this.polling || this.pending) return;
    this.polling = true; const revision = this.revision;
    try { const seconds = await bounded(this.api.getCurrentTime()); if (!this.disposed && revision === this.revision && !this.pending && Number.isFinite(seconds)) this.seconds = seconds; }
    catch { if (!this.disposed) this.fail(); }
    finally { this.polling = false; }
  }
  dispose() { this.disposed = true; this.playing = false; }
}
