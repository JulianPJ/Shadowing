import demo from '@/data/demo.json';
import { transcriptKey, validateQuizLesson } from '../transcript';
import { object } from '../transcript-validation';
import { readStorage } from '../storage';
import { lessonIdentity } from '../learner-progress';
import type { BookmarkSnapshot, LearnerHistory, LessonIdentity } from '../learner-types';
import type { Lesson } from '../types';
export function availableLesson(id: string): Lesson | null {
  try {
    const value = id === 'demo' ? demo : readStorage(`lesson:${id}`, null),
      r = object(value);
    const normalized = validateQuizLesson(r, { maxSegments: 10000, maxCharacters: 300000 });
    if (
      normalized.id !== id ||
      typeof r.title !== 'string' ||
      !r.title.trim() ||
      typeof r.author !== 'string' ||
      !['demo', 'youtube', 'vimeo', 'direct', 'upload'].includes(r.source as string)
    )
      return null;
    return { ...r, ...normalized } as Lesson;
  } catch {
    return null;
  }
}

export async function currentBookmarks(
  identities: LessonIdentity[],
  history?: LearnerHistory,
): Promise<BookmarkSnapshot[]> {
  const result: BookmarkSnapshot[] = [],
    seen = new Set<string>();
  for (const identity of identities) {
    if (seen.has(identity.lessonId)) continue;
    seen.add(identity.lessonId);
    const lesson = availableLesson(identity.lessonId);
    if (!lesson) {
      const records = [
        ...(history?.sessions ?? []),
        ...(history?.archives.map((a) => a.activity) ?? []),
      ]
        .filter((s) => s.lesson.lessonId === identity.lessonId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const latest = records[0];
      if (!latest) continue;
      const raw = readStorage<unknown>(`favorites:${identity.lessonId}`, []),
        ids = new Set(Array.isArray(raw) ? raw : []);
      const sections = new Map(
        records
          .filter((s) => s.lesson.transcriptKey === latest.lesson.transcriptKey)
          .flatMap((s) => s.sections)
          .filter((s) => ids.has(s.sectionId))
          .map((s) => [s.sectionId, { sectionId: s.sectionId, start: s.start, end: s.end }]),
      );
      result.push({ lesson: latest.lesson, sections: [...sections.values()] });
      continue;
    }
    const current = lessonIdentity(lesson, await transcriptKey(lesson));
    const raw = readStorage<unknown>(`favorites:${lesson.id}`, []),
      ids = Array.isArray(raw) ? new Set(raw.filter((id) => typeof id === 'string')) : new Set();
    result.push({
      lesson: current,
      sections: lesson.segments
        .filter((s) => ids.has(s.id))
        .map((s) => ({ sectionId: s.id, start: s.start, end: s.end })),
    });
  }
  return result;
}
