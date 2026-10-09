'use client';
import { SlidersHorizontal } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Mode } from '@/lib/types';
import { practicePreset, type DrillSettings, type PracticePreset } from '@/lib/drill-presets';
import {
  PLAYBACK_OFFSET_MAX_MS,
  PLAYBACK_OFFSET_MIN_MS,
  PLAYBACK_OFFSET_STEP_MS,
  PLAYBACK_SPEEDS,
} from '@/lib/storage/preferences';

const COARSE_OFFSET_MS = 500;

export function PracticeSettings({
  mode,
  drill,
  setDrill,
  selectPreset,
  speed,
  setSpeed,
  playbackOffsetMs,
  setPlaybackOffsetMs,
  ready,
  recording,
  drillRunning,
  drillPreparing,
  stopAutomation,
  onHandsFree,
  onStopTimed,
}: {
  mode: Mode;
  drill: DrillSettings;
  setDrill: Dispatch<SetStateAction<DrillSettings>>;
  selectPreset: (preset: PracticePreset) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  playbackOffsetMs: number;
  setPlaybackOffsetMs: Dispatch<SetStateAction<number>>;
  ready: boolean;
  recording: boolean;
  drillRunning: boolean;
  drillPreparing: boolean;
  stopAutomation: () => void;
  onHandsFree: () => void;
  onStopTimed: () => void;
}) {
  const defaults = practicePreset(drill.preset);
  const customized = (['repeats', 'pause', 'reveal', 'responseSeconds'] as const).some(
    (key) => drill[key] !== defaults[key],
  );
  const locked = mode === 'continuous' || recording || drillRunning;
  function shift(delta: number) {
    stopAutomation();
    setPlaybackOffsetMs((value) =>
      Math.min(PLAYBACK_OFFSET_MAX_MS, Math.max(PLAYBACK_OFFSET_MIN_MS, value + delta)),
    );
  }
  function update(patch: Partial<DrillSettings>) {
    stopAutomation();
    setDrill((current) => ({ ...current, ...patch }));
  }
  return (
    <div className="practice-settings-stack">
      <div className="practice-toolbar" role="group" aria-label="Practice settings">
        <label>
          Preset
          <select
            aria-label="Practice preset"
            value={drill.preset}
            disabled={recording || drillPreparing}
            onChange={(event) => selectPreset(event.target.value as PracticePreset)}
          >
            <option value="focus">Focus — listen, pause, repeat</option>
            <option value="support">Support — meaning after a pause</option>
            <option value="drill">Drill — listen twice, record</option>
            <option value="continuous">Continuous — listen through</option>
          </select>
        </label>
        <label className="speed-control">
          Speed
          <select
            aria-label="Playback speed"
            value={speed}
            disabled={recording}
            onChange={(event) => {
              stopAutomation();
              setSpeed(Number(event.target.value));
            }}
          >
            {PLAYBACK_SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {drill.preset === 'drill' ? (
          <button
            className="button"
            disabled={!ready || (!drillRunning && recording)}
            onClick={onHandsFree}
          >
            {drillPreparing
              ? 'Cancel microphone request'
              : drillRunning
                ? 'Stop hands-free drill'
                : 'Start hands-free drill'}
          </button>
        ) : null}
        {mode === 'shadowing' && drill.pause === 'timed' && !drillRunning ? (
          <button className="button" onClick={onStopTimed}>
            Stop timed practice
          </button>
        ) : null}
      </div>
      <details className="drill-advanced">
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          Advanced settings{customized ? ' · Customized' : ''}
        </summary>
        <div className="drill-advanced-fields">
          <label>
            Source repeats
            <select
              aria-label="Source repeat count"
              value={drill.repeats}
              disabled={locked}
              onChange={(event) => update({ repeats: Number(event.target.value) })}
            >
              {[1, 2, 3].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pause
            <select
              aria-label="Section pause behavior"
              value={drill.pause}
              disabled={locked}
              onChange={(event) => update({ pause: event.target.value as 'manual' | 'timed' })}
            >
              <option value="manual">Until I continue</option>
              <option value="timed">Timed speaking window</option>
            </select>
          </label>
          <label>
            Translation
            <select
              aria-label="Translation reveal behavior"
              value={drill.reveal}
              disabled={locked}
              onChange={(event) =>
                update({ reveal: event.target.value as 'manual' | 'after-pause' })
              }
            >
              <option value="manual">Reveal on request</option>
              <option value="after-pause">Reveal after source repeats</option>
            </select>
          </label>
          {drill.pause === 'timed' || drill.preset === 'drill' ? (
            <label>
              Speaking window (seconds)
              <input
                aria-label="Speaking window seconds"
                type="number"
                min={2}
                max={30}
                value={drill.responseSeconds}
                disabled={recording || drillRunning}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  if (Number.isInteger(seconds) && seconds >= 2 && seconds <= 30)
                    update({ responseSeconds: seconds });
                }}
              />
            </label>
          ) : null}
          <div
            className="offset-control"
            role="group"
            aria-label="Playback timing offset"
            title="Positive shifts section timing later; negative shifts it earlier. Select the value to reset."
          >
            <span>Subtitle sync</span>
            <button
              type="button"
              aria-label="Shift playback timing half a second earlier"
              disabled={playbackOffsetMs <= PLAYBACK_OFFSET_MIN_MS}
              onClick={() => shift(-COARSE_OFFSET_MS)}
            >
              −½s
            </button>
            <button
              type="button"
              aria-label="Shift playback timing 50 milliseconds earlier"
              disabled={playbackOffsetMs <= PLAYBACK_OFFSET_MIN_MS}
              onClick={() => shift(-PLAYBACK_OFFSET_STEP_MS)}
            >
              −
            </button>
            <button
              type="button"
              className="offset-value"
              aria-label="Reset playback timing offset"
              onClick={() => {
                stopAutomation();
                setPlaybackOffsetMs(0);
              }}
            >
              {playbackOffsetMs > 0 ? '+' : ''}
              {playbackOffsetMs} ms
            </button>
            <button
              type="button"
              aria-label="Shift playback timing 50 milliseconds later"
              disabled={playbackOffsetMs >= PLAYBACK_OFFSET_MAX_MS}
              onClick={() => shift(PLAYBACK_OFFSET_STEP_MS)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Shift playback timing half a second later"
              disabled={playbackOffsetMs >= PLAYBACK_OFFSET_MAX_MS}
              onClick={() => shift(COARSE_OFFSET_MS)}
            >
              +½s
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
