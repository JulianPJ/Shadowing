'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BANDS, TOPICS, type Preferences } from '@/lib/discover/types';
export function DiscoverPreferences({
  initial,
  onClose,
  onSave,
}: {
  initial: Preferences;
  onClose: () => void;
  onSave: (value: Preferences) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [value, setValue] = useState(initial);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="discover-preferences"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="discovery-preferences-title"
    >
      <div className="section-heading">
        <h2 id="discovery-preferences-title">Make Discover yours</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close preferences">
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        Choose a starting point. You can always explore something easier or harder.
      </p>
      <label>
        Your preferred content level
        <select
          value={value.preferredBand ?? 'auto'}
          onChange={(e) =>
            setValue({
              ...value,
              preferredBand:
                e.target.value === 'auto' ? null : (e.target.value as Preferences['preferredBand']),
            })
          }
        >
          <option value="auto">Suggest from my practice</option>
          {BANDS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">These are approximate content bands, not a proficiency test.</p>
      <fieldset>
        <legend>What are you curious about?</legend>
        <div className="discover-topic-choices">
          {Object.entries(TOPICS).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={value.topics.includes(key as keyof typeof TOPICS)}
                onChange={(e) =>
                  setValue({
                    ...value,
                    topics: e.target.checked
                      ? [...value.topics, key as keyof typeof TOPICS]
                      : value.topics.filter((t) => t !== key),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Your usual session
        <select
          value={value.duration}
          onChange={(e) =>
            setValue({ ...value, duration: e.target.value as Preferences['duration'] })
          }
        >
          {[
            ['any', 'Any length'],
            ['under5', 'Under 5 minutes'],
            ['5to10', '5–10 minutes'],
            ['10to20', '10–20 minutes'],
            ['over20', 'Over 20 minutes'],
          ].map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Variety
        <select
          value={value.diversity}
          onChange={(e) =>
            setValue({ ...value, diversity: e.target.value as Preferences['diversity'] })
          }
        >
          <option value="balanced">Balanced</option>
          <option value="wide">More creators and topics</option>
        </select>
      </label>
      <button className="button discover-primary" onClick={() => onSave(value)}>
        Save preferences
      </button>
    </dialog>
  );
}
