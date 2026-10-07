/** A small streaming anti-alias filter before the media library's linear downsampler. */
export class SpeechLowPass {
  private coefficients: Float64Array;
  private history: Float32Array;
  private cursor = 0;
  readonly delayFrames = 31;

  constructor(readonly sampleRate: number) {
    const count = this.delayFrames * 2 + 1;
    this.coefficients = new Float64Array(count);
    this.history = new Float32Array(count);
    const cutoff = Math.min(6800, sampleRate * 0.425) / sampleRate;
    let sum = 0;
    for (let n = 0; n < count; n++) {
      const distance = n - this.delayFrames;
      const sinc =
        distance === 0
          ? 2 * cutoff
          : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (count - 1));
      this.coefficients[n] = sinc * window;
      sum += this.coefficients[n];
    }
    for (let n = 0; n < count; n++) this.coefficients[n] /= sum;
  }

  process(samples: Float32Array): Float32Array {
    const result = new Float32Array(samples.length);
    const count = this.history.length;
    for (let frame = 0; frame < samples.length; frame++) {
      this.history[this.cursor] = samples[frame];
      let value = 0;
      let read = this.cursor;
      for (let tap = 0; tap < count; tap++) {
        value += this.history[read] * this.coefficients[tap];
        if (--read < 0) read = count - 1;
      }
      result[frame] = value;
      this.cursor = (this.cursor + 1) % count;
    }
    return result;
  }

  reset() {
    this.history.fill(0);
    this.cursor = 0;
  }
}
