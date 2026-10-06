import type { Mode } from './types';
import { readStorage } from './storage/browser';

export type PracticePreset = 'focus' | 'support' | 'drill' | 'continuous';
export type DrillSettings = {
  preset: PracticePreset;
  repeats: number;
  pause: 'manual' | 'timed';
  reveal: 'manual' | 'after-pause';
  responseSeconds: number;
};

export function practicePreset(preset: PracticePreset): DrillSettings {
  return {
    preset,
    repeats: preset === 'drill' ? 2 : 1,
    pause: 'manual',
    reveal: preset === 'support' ? 'after-pause' : 'manual',
    responseSeconds: 5,
  };
}

export function normalizeDrillSettings(value: unknown, mode: Mode): DrillSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<DrillSettings>) : {};
  const selected = ['focus', 'support', 'drill', 'continuous'].includes(raw.preset ?? '')
    ? raw.preset!
    : mode === 'continuous'
      ? 'continuous'
      : 'focus';
  const preset =
    mode === 'continuous' ? 'continuous' : selected === 'continuous' ? 'focus' : selected;
  const defaults = practicePreset(preset);
  return {
    ...defaults,
    repeats: [1, 2, 3].includes(raw.repeats ?? 0) ? raw.repeats! : defaults.repeats,
    pause: raw.pause === 'timed' ? 'timed' : 'manual',
    reveal: raw.reveal === 'after-pause' ? 'after-pause' : defaults.reveal,
    responseSeconds:
      typeof raw.responseSeconds === 'number' &&
      Number.isInteger(raw.responseSeconds) &&
      raw.responseSeconds >= 2 &&
      raw.responseSeconds <= 30
        ? raw.responseSeconds
        : 5,
  };
}

export function loadDrillSettings(mode: Mode): DrillSettings {
  return normalizeDrillSettings(readStorage('drill:settings', null), mode);
}
