'use client';
import { useId, useState } from 'react';
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
  onApply: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [tagName, setTagName] = useState(''),
    [name, setName] = useState(''),
    [id, setId] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const optionsId = useId();
  const existing = tags.find(
    (tag) => tag.name.toLocaleLowerCase() === tagName.trim().toLocaleLowerCase(),
  );
  async function applyTag() {
    if (busy || !selected.length || !tagName.trim()) return;
    setBusy(true);
    onError('');
    setNotice('');
    try {
      const tagId = existing?.id ?? crypto.randomUUID();
      if (!existing) await changeTags({ action: 'create', id: tagId, name: tagName.trim() });
      await onApply(tagId);
      setNotice(
        `Applied ${tagName.trim()} to ${selected.length} selected ${selected.length === 1 ? 'word' : 'words'}.`,
      );
      setTagName('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not apply this tag.');
    } finally {
      setBusy(false);
    }
  }
  async function edit(action: 'create' | 'rename' | 'delete') {
    if (busy) return;
    if (
      action === 'delete' &&
      !window.confirm(
        'Delete this tag from all saved words? Your words, decks and review schedules stay available.',
      )
    )
      return;
    setBusy(true);
    onError('');
    setNotice('');
    try {
      await changeTags(
        action === 'delete'
          ? { action, id }
          : { action, id: action === 'create' ? crypto.randomUUID() : id, name },
      );
      setNotice(
        action === 'delete'
          ? 'Tag deleted. Saved words and their reviews are kept.'
          : action === 'rename'
            ? 'Tag renamed.'
            : 'Tag created. Choose it above to apply it.',
      );
      setName('');
      if (action === 'delete') setId('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not update this tag.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tag-controls">
      <form
        className="collection-tag-form"
        onSubmit={(event) => {
          event.preventDefault();
          void applyTag();
        }}
      >
        <label>
          Add tag to selected words
          <input
            value={tagName}
            onChange={(event) => setTagName(event.target.value)}
            maxLength={64}
            list={optionsId}
            placeholder="Choose or create: travel, useful phrase…"
          />
        </label>
        <datalist id={optionsId}>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <button
          className="button small-button"
          disabled={busy || !selected.length || !tagName.trim()}
        >
          {busy ? 'Applying…' : existing ? 'Apply tag' : 'Create and apply tag'}
        </button>
      </form>
      <details className="tag-management">
        <summary>Tags · describe your words</summary>
        <p className="small muted">
          Tags describe a word and never change its review schedule. Create and apply a tag above,
          or manage all tags here. Up to 100 tags and 10 per word.
        </p>
        <label>
          Tag
          <select
            aria-label="Manage tag"
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              setName(tags.find((tag) => tag.id === event.target.value)?.name ?? '');
            }}
          >
            <option value="">New tag</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag name
          <input
            maxLength={64}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Travel, useful expression…"
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
              onClick={() => {
                setBusy(true);
                void Promise.resolve(onApply(id))
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              Tag selected entries
            </button>
            <button
              className="text-button dictionary-remove"
              disabled={busy}
              onClick={() => void edit('delete')}
            >
              Delete tag
            </button>
          </>
        ) : null}
      </details>
      {notice ? (
        <p className="collection-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
