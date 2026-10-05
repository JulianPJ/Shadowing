import { CHECKPOINT_MS } from './learner-progress';

/** The 1s sampling loop only marks dirty. It never writes on every sample. */
export class PracticeCheckpoint {
  private dirty = false;
  private lastWrite: number;
  constructor(now: number) {
    this.lastWrite = now;
  }
  mark() {
    this.dirty = true;
  }
  due(now: number) {
    return this.dirty && now - this.lastWrite >= CHECKPOINT_MS;
  }
  flush(now: number, write: () => boolean): boolean | null {
    if (!this.dirty) return null;
    const saved = write();
    this.dirty = false;
    this.lastWrite = now;
    return saved;
  }
}
