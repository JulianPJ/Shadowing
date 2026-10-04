'use client';
import { memo, useEffect, useState } from 'react';
import { hasKanji, type JapaneseReadingToken } from '@/lib/japanese-readings';

export const JapaneseText = memo(function JapaneseText({ text, furigana = false }: { text: string; furigana?: boolean }) {
  const [annotation, setAnnotation] = useState<{ text: string; tokens: readonly JapaneseReadingToken[] } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!furigana || !hasKanji(text)) return;
    let active = true;
    void import('@/lib/furigana-client').then(client => client.japaneseReadings(text)).then(tokens => {
      if (active) { setAnnotation({ text, tokens }); setUnavailable(false); }
    }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [text, furigana]);
  if (!furigana) return text;
  const tokens = annotation?.text === text ? annotation.tokens : [{ text }];
  return <span className="japanese-text with-furigana" aria-busy={hasKanji(text) && annotation?.text !== text && !unavailable} title={unavailable ? 'Readings are unavailable. Turn Furigana off and on to retry.' : annotation?.text !== text && hasKanji(text) ? 'Loading local readings…' : undefined}>
    {tokens.map((token, index) => token.reading ? <ruby key={index}>{token.text}<rt aria-hidden="true">{token.reading}</rt></ruby> : token.text)}
  </span>;
});
