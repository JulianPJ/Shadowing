'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { hasKanji, type JapaneseReadingToken } from '@/lib/japanese-readings';

function canonicalOffset(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  const fragment = range.cloneContents();
  fragment.querySelectorAll('rt').forEach((element) => element.remove());
  return fragment.textContent?.length ?? 0;
}

function selectedCanonicalText(root: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return '';
  const start = canonicalOffset(root, range.startContainer, range.startOffset);
  const end = canonicalOffset(root, range.endContainer, range.endOffset);
  return text.slice(Math.min(start, end), Math.max(start, end)).trim();
}

function LookupToken({
  children,
  value,
  onLookup,
}: {
  children: React.ReactNode;
  value: string;
  onLookup: (text: string) => void;
}) {
  const choose = () => {
    if (window.getSelection()?.toString().trim()) return;
    onLookup(value);
  };
  return (
    <span
      className="lookup-token"
      role="button"
      tabIndex={0}
      data-lookup={value}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onLookup(value);
        }
      }}
    >
      {children}
    </span>
  );
}

export const JapaneseText = memo(function JapaneseText({
  text,
  furigana = false,
  onLookup,
}: {
  text: string;
  furigana?: boolean;
  onLookup?: (text: string) => void;
}) {
  const [annotation, setAnnotation] = useState<{
    text: string;
    tokens: readonly JapaneseReadingToken[];
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const words = useMemo(
    () =>
      onLookup
        ? Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text))
        : [],
    [onLookup, text],
  );

  useEffect(() => {
    if (!furigana || !hasKanji(text)) return;
    let active = true;
    void import('@/lib/furigana-client')
      .then((client) => client.japaneseReadings(text))
      .then((tokens) => {
        if (active) {
          setAnnotation({ text, tokens });
          setUnavailable(false);
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [text, furigana]);

  if (!furigana && !onLookup) return text;

  const lookupSelection = () => {
    if (!onLookup || !root.current) return;
    const selected = selectedCanonicalText(root.current, text);
    if (selected && selected.length <= 120) onLookup(selected);
  };

  if (!furigana) {
    return (
      <span
        ref={root}
        className="japanese-text lookup-enabled"
        onMouseUp={lookupSelection}
        title="Click a word or select a phrase to save it"
      >
        {words.map((part, index) =>
          part.isWordLike ? (
            <LookupToken key={index} value={part.segment} onLookup={onLookup!}>
              {part.segment}
            </LookupToken>
          ) : (
            <span key={index}>{part.segment}</span>
          ),
        )}
      </span>
    );
  }

  const tokens = annotation?.text === text ? annotation.tokens : [{ text }];
  return (
    <span
      ref={root}
      className={`japanese-text with-furigana${onLookup ? ' lookup-enabled' : ''}`}
      aria-busy={hasKanji(text) && annotation?.text !== text && !unavailable}
      onMouseUp={lookupSelection}
      title={
        unavailable
          ? 'Readings are unavailable. Turn Furigana off and on to retry.'
          : annotation?.text !== text && hasKanji(text)
            ? 'Loading local readings…'
            : onLookup
              ? 'Click a word or select a phrase to save it'
              : undefined
      }
    >
      {tokens.map((token, index) => {
        const content = token.reading ? (
          <ruby>
            {token.text}
            <rt aria-hidden="true">{token.reading}</rt>
          </ruby>
        ) : (
          token.text
        );
        return onLookup && /[\p{L}\p{N}]/u.test(token.text) ? (
          <LookupToken key={index} value={token.text} onLookup={onLookup}>
            {content}
          </LookupToken>
        ) : (
          <span key={index}>{content}</span>
        );
      })}
    </span>
  );
});
