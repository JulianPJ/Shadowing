'use client';
import { useState } from 'react';
import type { Tag } from '@/lib/tags/types';
import { changeTags } from '@/lib/tags/client';
export function TagControls({
  tags,
  selected,
  onApply,
  onError,
}: {
  tags: Tag[];
  selected: string[];
  onApply: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(''),
    [id, setId] = useState(''),
    [busy, setBusy] = useState(false);
  async function edit(action: 'create' | 'rename' | 'delete') {
    setBusy(true);
    onError('');
    try {
      await changeTags(
        action === 'delete'
          ? { action, id }
          : { action, id: action === 'create' ? crypto.randomUUID() : id, name },
      );
      setName('');
      if (action === 'delete') setId('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="tag-controls">
      <summary>Tags · describe your words</summary>
      <p className="small muted">
        Tags describe a word. Decks group reviews. Up to 100 tags and 10 per word.
      </p>
      <label>
        Tag{' '}
        <select
          aria-label="Manage tag"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setName(tags.find((t) => t.id === e.target.value)?.name ?? '');
          }}
        >
          <option value="">New tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tag name{' '}
        <input
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="旅行, finance, useful-expression"
        />
      </label>
      <button
        className="button small-button"
        disabled={busy || !name.trim()}
        onClick={() => void edit(id ? 'rename' : 'create')}
      >
        {id ? 'Rename tag' : 'Create tag'}
      </button>
      {id ? (
        <>
          <button
            className="text-button"
            disabled={busy || !selected.length}
            onClick={() => onApply(id)}
          >
            Tag selected entries
          </button>
          <button className="text-button" disabled={busy} onClick={() => void edit('delete')}>
            Delete tag
          </button>
        </>
      ) : null}
    </details>
  );
}
