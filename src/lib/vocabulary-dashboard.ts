import type { DictionaryEntry } from './dictionary/types';
import type { ReviewState } from './review/types';
import type { ReviewEvent } from './review/history';
import { shiftStudyDay, studyDay } from './study-day';
import { hiragana } from './japanese-readings';

/** Evidence ranking, not a calibrated difficulty or recall score. Deduplicate multi-device events. */
export function vocabularyDashboard(
  cards: ReviewState[],
  events: ReviewEvent[],
  now: string,
  timeZone?: string,
) {
  const today = studyDay(now, timeZone);
  const recent = shiftStudyDay(today, -6);
  const history = [...new Map(events.map((e) => [e.operationId, e])).values()].filter(
    (e) => e.reviewedAt <= now,
  );
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayOf = (stamp: string) => {
    const parts = formatter.formatToParts(new Date(stamp));
    return ['year', 'month', 'day']
      .map((type) => parts.find((p) => p.type === type)!.value)
      .join('-');
  };
  const eventDays = new Map(history.map((e) => [e.operationId, dayOf(e.reviewedAt)]));
  const activityCounts = new Map<string, number>();
  for (const day of eventDays.values()) activityCounts.set(day, (activityCounts.get(day) ?? 0) + 1);
  const todayEvents = history.filter((e) => eventDays.get(e.operationId) === today);
  const grades = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const e of todayEvents) grades[e.grade]++;
  const byEntry = new Map<string, ReviewEvent[]>();
  for (const e of history)
    if (eventDays.get(e.operationId)! >= recent) {
      const list = byEntry.get(e.entryId) ?? [];
      list.push(e);
      byEntry.set(e.entryId, list);
    }
  const difficult = cards
    .flatMap((c) => {
      const available = byEntry.get(c.entryId) ?? [];
      const again = available.filter((e) => e.grade === 'again').length;
      const hard = available.filter((e) => e.grade === 'hard').length;
      const reasons = [
        ...(c.lapses ? [`${c.lapses} recorded ${c.lapses === 1 ? 'lapse' : 'lapses'}`] : []),
        ...(again ? [`${again} Again in available recent history`] : []),
        ...(hard ? [`${hard} Hard in available recent history`] : []),
      ];
      return reasons.length
        ? [
            {
              entryId: c.entryId,
              reasons,
              evidence: available.length,
              weight: c.lapses * 2 + again * 2 + hard,
            },
          ]
        : [];
    })
    .sort((a, b) => b.weight - a.weight || a.entryId.localeCompare(b.entryId));
  const active = cards.filter((c) => c.status !== 'suspended');
  const dueDays = active.map((c) => dayOf(c.dueAt));
  const scheduleCounts = new Map<string, number>();
  for (const day of dueDays) scheduleCounts.set(day, (scheduleCounts.get(day) ?? 0) + 1);
  return {
    today,
    grades,
    todayEvents,
    reviewedWords: [...new Set(todayEvents.map((e) => e.entryId))],
    difficult,
    dueToday: dueDays.filter((day) => day <= today).length,
    activity: Array.from({ length: 7 }, (_, i) => {
      const day = shiftStudyDay(today, i - 6);
      return {
        day,
        answers: activityCounts.get(day) ?? 0,
      };
    }),
    schedule: Array.from({ length: 14 }, (_, i) => {
      const day = shiftStudyDay(today, i);
      return { day, cards: scheduleCounts.get(day) ?? 0 };
    }),
    overdue: dueDays.filter((day) => day < today).length,
    historyStart: history.length
      ? history.reduce((a, b) => (a.reviewedAt < b.reviewedAt ? a : b)).reviewedAt
      : null,
  };
}
export function wordKanji(term: string) {
  return [...new Set(term.match(/\p{Script=Han}/gu) ?? [])];
}
export function relatedWords(word: DictionaryEntry, entries: DictionaryEntry[]) {
  return entries.filter(
    (e) =>
      e.id !== word.id &&
      !!word.reading &&
      !!e.reading &&
      hiragana(e.reading) === hiragana(word.reading),
  );
}
