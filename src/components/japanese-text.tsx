'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { hasKanji, annotateJapanese, type MorphologicalToken } from '@/lib/japanese-readings';
import { japaneseLexicalSpans } from '@/lib/japanese-lexical-spans';
import { contentWord } from '@/lib/knowledge/analysis';
import { useWordKnowledge } from './use-word-knowledge';
import { storageAccount } from '@/lib/storage/browser';

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
  const { states } = useWordKnowledge(!!onLookup || highlightWords);
  const [morphology, setMorphology] = useState<{
    text: string;
    tokens: readonly MorphologicalToken[];
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [focused, setFocused] = useState(0);
  const [selectionRange, setPhrase] = useState<{
    text: string;
    anchor: number;
    end: number;
  } | null>(null);
  const phrase = selectionRange?.text === text ? selectionRange : null;
  const [selectionText, setNativeSelection] = useState<{ text: string; selected: string } | null>(
    null,
  );
  const nativeSelection = selectionText?.text === text ? selectionText.selected : '';
  const [lookupText, setLookupText] = useState<string | null>(null);
  const [pendingLookupText, setLookingUp] = useState<string | null>(null);
  const lookingUp = pendingLookupText === text;
  const root = useRef<HTMLSpanElement>(null);
  const lookupRequest = useRef(0);
  const needsAnalysis =
    (!!onLookup && lookupText === text) ||
    ((!!onLookup || highlightWords) && Object.keys(states).length > 0) ||
    (furigana && hasKanji(text));
  const tokens = morphology?.text === text ? morphology.tokens : undefined;
  const spans = useMemo(() => japaneseLexicalSpans(text, tokens), [text, tokens]);
  const wordIndices = spans.flatMap((span, index) => (span.wordLike ? [index] : []));
  const activeIndex = wordIndices.includes(focused) ? focused : (wordIndices[0] ?? 0);
  const phraseText = phrase
    ? text.slice(
        spans[Math.min(phrase.anchor, phrase.end)]?.start,
        spans[Math.max(phrase.anchor, phrase.end)]?.end,
      )
    : nativeSelection;

  const commitMorphology = useCallback(
    (analyzed: readonly MorphologicalToken[], selectedOffset?: number) => {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const offset =
        selectedOffset ??
        (active?.dataset.lookupStart !== undefined && root.current?.contains(active)
          ? Number(active.dataset.lookupStart)
          : undefined);
      // Inflection grouping can replace the focused suffix node. Commit its new
      // target before moving focus or opening lookup so closing returns to the word.
      flushSync(() => setMorphology({ text, tokens: analyzed }));
      if (offset !== undefined) {
        const canonical = japaneseLexicalSpans(text, analyzed).find(
          (span) => span.start <= offset && span.end > offset,
        );
        Array.from(root.current?.querySelectorAll<HTMLElement>('[data-lookup-start]') ?? [])
          .find((element) => Number(element.dataset.lookupStart) === canonical?.start)
          ?.focus({ preventScroll: true });
      }
    },
    [text],
  );

  useEffect(() => {
    if (!needsAnalysis) return;
    let active = true;
    const controller = new AbortController();
    void import('@/lib/furigana-client')
      .then((client) =>
        client.japaneseMorphology(text, { priority: analysisPriority, signal: controller.signal }),
      )
      .then((analyzed) => {
        if (active && analyzed.map((token) => token.surface_form).join('') === text) {
          commitMorphology(analyzed);
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
  }, [text, needsAnalysis, analysisPriority, commitMorphology]);

  useEffect(
    () => () => {
      lookupRequest.current++;
    },
    [text],
  );

  useEffect(() => {
    const cancel = () => {
      lookupRequest.current++;
      setLookingUp(null);
      setPhrase(null);
      setNativeSelection(null);
    };
    window.addEventListener('hibiki:account-changing', cancel);
    return () => window.removeEventListener('hibiki:account-changing', cancel);
  }, []);

  useEffect(() => {
    if (!onLookup) return;
    const selectionChanged = () => {
      const selected = root.current ? selectedCanonicalText(root.current, text) : '';
      setNativeSelection(selected.length <= 120 && selected ? { text, selected } : null);
    };
    document.addEventListener('selectionchange', selectionChanged);
    return () => document.removeEventListener('selectionchange', selectionChanged);
  }, [text, onLookup]);

  if (!furigana && !onLookup && !highlightWords) return text;

  const choosePhrase = () => {
    if (!phraseText || phraseText.length > 120) return;
    onLookup?.(phraseText);
    lookupRequest.current++;
    setLookingUp(null);
    setPhrase(null);
    setNativeSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const chooseWord = async (index: number) => {
    if (!onLookup) return;
    const span = spans[index];
    setPhrase(null);
    if (tokens) {
      onLookup(span.text);
      return;
    }
    const owner = storageAccount();
    const request = ++lookupRequest.current;
    const current = () =>
      request === lookupRequest.current &&
      root.current?.dataset.source === text &&
      storageAccount() === owner;
    setLookupText(text);
    setLookingUp(text);
    try {
      const client = await import('@/lib/furigana-client');
      const analyzed = await client.japaneseMorphology(text, { priority: 'interactive' });
      if (!current()) return;
      const canonical = japaneseLexicalSpans(text, analyzed).find(
        (candidate) => candidate.start <= span.start && candidate.end > span.start,
      );
      commitMorphology(analyzed, span.start);
      onLookup(canonical?.text ?? span.text);
    } catch {
      if (current()) onLookup(span.text);
    } finally {
      if (current()) setLookingUp(null);
    }
  };

  return (
    <>
      <span
        ref={root}
        data-source={text}
        className={`japanese-text${furigana ? ' with-furigana' : ''}${onLookup ? ' lookup-enabled' : ''}`}
        aria-busy={lookingUp || (furigana && hasKanji(text) && !tokens && !unavailable)}
        onPointerUp={(event) => {
          // Native touch selection uses the explicit phrase action after its handles settle.
          if (event.pointerType !== 'mouse' || !onLookup || !root.current) return;
          const selected = selectedCanonicalText(root.current, text);
          if (selected && selected.length <= 120) onLookup(selected);
        }}
        title={
          unavailable && furigana
            ? 'Readings are unavailable. Word lookup and phrase selection still work.'
            : onLookup
              ? 'Choose a word. Arrow keys move; Shift + arrow selects a phrase; Enter looks it up.'
              : undefined
        }
      >
        {spans.map((span, index) => {
          const state =
            (onLookup || highlightWords) && span.tokens.length
              ? (states[span.lemma]?.state ??
                (span.tokens.some(contentWord) ? 'unknown' : undefined))
              : undefined;
          const content = furigana
            ? annotateJapanese(span.text, span.tokens).map((part, partIndex) =>
                part.reading ? (
                  <ruby key={partIndex}>
                    {part.text}
                    <rt aria-hidden="true">{part.reading}</rt>
                  </ruby>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )
            : span.text;
          const selected =
            !!phrase &&
            index >= Math.min(phrase.anchor, phrase.end) &&
            index <= Math.max(phrase.anchor, phrase.end);
          return (
            <span
              key={`${span.start}:${span.end}`}
              className={
                `${onLookup && span.wordLike ? 'lookup-token' : ''}${state ? ` word-state-${state}` : ''}${selected ? ' lookup-selected' : ''}`.trim() ||
                undefined
              }
              role={onLookup && span.wordLike ? 'button' : undefined}
              tabIndex={onLookup && span.wordLike ? (index === activeIndex ? 0 : -1) : undefined}
              aria-label={onLookup && span.wordLike ? `Look up ${span.text}` : undefined}
              data-lookup={onLookup && span.wordLike ? span.text : undefined}
              data-lookup-start={onLookup && span.wordLike ? span.start : undefined}
              data-lemma={span.lemma}
              data-word-state={state}
              onPointerEnter={onLookup && span.wordLike ? () => setLookupText(text) : undefined}
              onFocus={
                onLookup && span.wordLike
                  ? () => {
                      setFocused(index);
                      setLookupText(text);
                    }
                  : undefined
              }
              onClick={
                onLookup && span.wordLike
                  ? () => {
                      if (window.getSelection()?.toString().trim()) return;
                      void chooseWord(index);
                    }
                  : undefined
              }
              onKeyDown={
                onLookup && span.wordLike
                  ? (event) => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        const position = wordIndices.indexOf(index);
                        const next =
                          event.key === 'Home'
                            ? wordIndices[0]
                            : event.key === 'End'
                              ? wordIndices.at(-1)!
                              : wordIndices[
                                  Math.max(
                                    0,
                                    Math.min(
                                      wordIndices.length - 1,
                                      position + (event.key === 'ArrowRight' ? 1 : -1),
                                    ),
                                  )
                                ];
                        setPhrase(
                          event.shiftKey
                            ? { text, anchor: phrase?.anchor ?? index, end: next }
                            : null,
                        );
                        setFocused(next);
                        root.current
                          ?.querySelectorAll<HTMLElement>('[data-lookup]')
                          [wordIndices.indexOf(next)]?.focus();
                      } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (phrase) choosePhrase();
                        else void chooseWord(index);
                      } else if (event.key === 'Escape') {
                        setPhrase(null);
                        setNativeSelection(null);
                      }
                    }
                  : undefined
              }
            >
              {content}
            </span>
          );
        })}
      </span>
      {lookingUp ? (
        <span className="lookup-loading small" role="status">
          Finding the full word…
        </span>
      ) : null}
      {onLookup && phraseText ? (
        <button
          type="button"
          className="text-button lookup-phrase-action"
          onPointerDown={(event) => event.preventDefault()}
          onClick={choosePhrase}
          disabled={phraseText.length > 120}
        >
          Look up selected phrase
        </button>
      ) : null}
    </>
  );
});
