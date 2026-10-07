import { AUDIO_SAMPLE_RATE } from './types';

/** Allocate one bounded PCM window. Empty timeline gaps stay silent rather than shifting later speech. */
export function allocateWave(duration: number) {
  const frames = Math.ceil(duration * AUDIO_SAMPLE_RATE);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 122)
    throw new Error('Audio preparation exceeded the bounded chunk duration.');
  const buffer = new ArrayBuffer(44 + frames * 2);
  const header = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  header.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, AUDIO_SAMPLE_RATE, true);
  header.setUint32(28, AUDIO_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, frames * 2, true);
  return { buffer, pcm: new Int16Array(buffer, 44) };
}
