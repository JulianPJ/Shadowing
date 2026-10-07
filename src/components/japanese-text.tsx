'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasKanji,
  annotateJapanese,
  type JapaneseReadingToken,
  type MorphologicalToken,
} from '@/lib/japanese-readings';
import { canonicalLemma } from '@/lib/lexicon/lookup';
import { contentWord } from '@/lib/knowledge/analysis';
import type { WordState } from '@/lib/knowledge/types';
import { useWordKnowledge } from './use-word-knowledge';

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
  lemma,
  state,
}: {
  children: React.ReactNode;
  value: string;
  onLookup: (text: string) => void;
  lemma?: string;
  state?: WordState;
}) {
  const choose = () => {
    if (window.getSelection()?.toString().trim()) return;
    onLookup(value);
  };
  return (
    <span
      className={`lookup-token${state ? ` word-state-${state}` : ''}`}
      role="button"
      tabIndex={0}
      data-lookup={value}
      data-lemma={lemma}
      data-word-state={state}
      title={lemma && state ? `${lemma} · ${state[0].toUpperCase() + state.slice(1)}` : undefined}
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
  highlightWords = false,
  analysisPriority = 'interactive',
}: {
  text: string;
  furigana?: boolean;
  onLookup?: (text: string) => void;
  highlightWords?: boolean;
  analysisPriority?: 'interactive' | 'background';
}) {
  const [annotation, setAnnotation] = useState<{
    text: string;
    tokens: readonly JapaneseReadingToken[];
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const { states } = useWordKnowledge(!!onLookup || highlightWords);
  const [morphology, setMorphology] = useState<{
    text: string;
    tokens: readonly MorphologicalToken[];
  } | null>(null);
  const highlighting = (!!onLookup || highlightWords) && Object.keys(states).length > 0;
  const root = useRef<HTMLSpanElement>(null);
  const words = useMemo(
    () =>
      onLookup ? Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)) : [],
    [onLookup, text],
  );

  useEffect(() => {
    if (!furigana || !hasKanji(text)) return;
    let active = true;
    const controller = new AbortController();
    void import('@/lib/furigana-client')
      .then((client) =>
        client.japaneseReadings(text, { priority: analysisPriority, signal: controller.signal }),
      )
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
      controller.abort();
    };
  }, [text, furigana, analysisPriority]);

  useEffect(() => {
    if (!highlighting) return;
    let active = true;
    const controller = new AbortController();
    void import('@/lib/furigana-client')
      .then((client) =>
        client.japaneseMorphology(text, { priority: analysisPriority, signal: controller.signal }),
      )
      .then((tokens) => {
        if (active && tokens.map((token) => token.surface_form).join('') === text)
          setMorphology({ text, tokens });
      })
      .catch(() => {
        /* Plain canonical Japanese and lookup remain usable. */
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [text, highlighting, analysisPriority]);

  if (!furigana && !onLookup && (!highlighting || morphology?.text !== text)) return text;

  const lookupSelection = () => {
    if (!onLookup || !root.current) return;
    const selected = selectedCanonicalText(root.current, text);
    if (selected && selected.length <= 120) onLookup(selected);
  };

  if (highlighting && morphology?.text === text) {
    return (
      <span
        ref={root}
        className={`japanese-text lookup-enabled${furigana ? ' with-furigana' : ''}`}
        onMouseUp={lookupSelection}
      >
        {morphology.tokens.map((token, index) => {
          const lemma = canonicalLemma(token);
          const state = states[lemma]?.state ?? (contentWord(token) ? 'unknown' : undefined);
          const children = furigana
            ? annotateJapanese(token.surface_form, [token]).map((part, partIndex) =>
                part.reading ? (
                  <ruby key={partIndex}>
                    {part.text}
                    <rt aria-hidden="true">{part.reading}</rt>
                  </ruby>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )
            : token.surface_form;
          return onLookup && /[\p{L}\p{N}]/u.test(token.surface_form) ? (
            <LookupToken
              key={index}
              value={token.surface_form}
              lemma={lemma}
              state={state}
              onLookup={onLookup}
            >
              {children}
            </LookupToken>
          ) : (
            <span
              key={index}
              className={state ? `word-state-${state}` : undefined}
              data-lemma={lemma}
              data-word-state={state}
            >
              {children}
            </span>
          );
        })}
      </span>
    );
  }

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
