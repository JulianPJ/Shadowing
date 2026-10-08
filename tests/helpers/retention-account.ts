import type { BrowserContext } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import type { DictionaryEntry } from '../../src/lib/dictionary/types';
import type { ReviewSnapshot, ReviewOperation } from '../../src/lib/review/types';
import { emptyReview, applyLocalReview } from '../../src/lib/review/local';
import { dictionarySource } from '../../src/lib/dictionary/source';
import type { Lesson } from '../../src/lib/types';
import { dictionaryCursor, parseDictionaryCursor } from '../../src/lib/dictionary/query';
import type { Tag, TagOperation } from '../../src/lib/tags/types';
import { tagName } from '../../src/lib/tags/validation';
type Remote = {
  tags: Tag[];
  queries: string[];
  entries: DictionaryEntry[];
  review: ReviewSnapshot;
  offline: boolean;
  writes: ReviewOperation[];
};
export async function connect(context: BrowserContext, plan: AccountUser['plan'] = 'free') {
  const user: AccountUser = {
    id: 'retention-' + plan,
    email: plan + '@example.com',
    name: 'Learner',
    emailVerified: true,
    plan,
  };
  await context.addInitScript(
    (id) =>
      localStorage.setItem(
        `hibiki:v1:account:${id}:sync:import-decision`,
        JSON.stringify('declined'),
      ),
    user.id,
  );
  const remote: Remote = {
    entries: [],
    tags: [],
    queries: [],
    review: {
      ...emptyReview(),
      decks: [{ id: 'inbox', name: 'Inbox', createdAt: '', updatedAt: '' }],
    },
    offline: false,
    writes: [],
  };
  await context.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user, googleEnabled: false, emailEnabled: false } }),
  );
  await context.route('**/api/sync/bootstrap*', (route) =>
    route.fulfill({ json: { data: emptySync(), nextCursor: null } }),
  );
  await context.route('**/api/sync/push', (route) => route.fulfill({ json: { ok: true } }));
  await context.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'morning' } }),
  );
  await context.route('**/api/review', (route) => {
    if (remote.offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'POST') {
      const op = route.request().postDataJSON() as ReviewOperation;
      remote.writes.push(op);
      const before = remote.review.cards.find(
        (card) => 'entryId' in op && card.entryId === op.entryId,
      );
      remote.review = applyLocalReview(remote.review, op);
      if (op.action === 'grade' && before?.revision === op.revision) {
        remote.review.history = [
          ...(remote.review.history ?? []),
          {
            operationId: op.operationId,
            entryId: op.entryId,
            grade: op.grade,
            reviewedAt: op.reviewedAt,
            status: before.status as 'new' | 'learning' | 'review',
          },
        ];
        remote.review.historySince = new Date(Date.now() - 7 * 86400000).toISOString();
      } else if (op.action === 'undo' && remote.review.history) {
        remote.review.history = remote.review.history.filter(
          (event) => event.operationId !== op.targetOperationId,
        );
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: remote.review });
  });
  await context.route('**/api/dictionary*', (route) => {
    if (remote.offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'GET') {
      const params = new URL(route.request().url()).searchParams;
      remote.queries.push(params.toString());
      let entries = remote.entries.filter(
        (e) =>
          (!params.has('ids') || params.get('ids')!.split(',').includes(e.id)) &&
          (!params.has('lessonId') || e.source.lessonId === params.get('lessonId')) &&
          (!params.has('transcriptKey') ||
            e.source.transcriptKey === params.get('transcriptKey')) &&
          (!params.has('term') || e.normalizedTerm === params.get('term')) &&
          (!params.has('search') ||
            [e.term, e.reading ?? '', e.translation].some((value) =>
              value.toLocaleLowerCase().includes(params.get('search')!.toLocaleLowerCase()),
            )) &&
          (!params.has('deckId') ||
            remote.review.memberships.some(
              (m) => m.entryId === e.id && m.deckId === params.get('deckId'),
            )) &&
          (!params.has('tagId') || e.tags?.some((t) => t.id === params.get('tagId'))),
      );
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (params.has('ids')) return route.fulfill({ json: { entries } });
      if (params.has('cursor')) {
        const cursor = parseDictionaryCursor(params.get('cursor')!);
        entries = entries.filter(
          (e) =>
            e.createdAt < cursor.createdAt ||
            (e.createdAt === cursor.createdAt && e.id < cursor.id),
        );
      }
      const limit = Number(params.get('limit') ?? 100),
        more = entries.length > limit;
      entries = entries.slice(0, limit);
      const last = entries.at(-1);
      return route.fulfill({
        json: {
          entries,
          nextCursor: more && last ? dictionaryCursor(last.createdAt, last.id) : null,
        },
      });
    }
    const body = route.request().postDataJSON();
    if (body.action === 'delete') {
      remote.entries = remote.entries.filter((e) => e.id !== body.id);
      remote.review.cards = remote.review.cards.filter((c) => c.entryId !== body.id);
      return route.fulfill({ json: { ok: true } });
    }
    const now = new Date().toISOString();
    const entry: DictionaryEntry = {
      ...body.entry,
      id: crypto.randomUUID(),
      normalizedTerm: body.entry.term,
      createdAt: now,
      updatedAt: now,
    };
    remote.entries.unshift(entry);
    remote.review.memberships.push({ deckId: 'inbox', entryId: entry.id });
    return route.fulfill({ json: { entry } });
  });
  await context.route('**/api/tags', (route) => {
    if (remote.offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'POST') {
      const op = route.request().postDataJSON() as TagOperation,
        now = new Date().toISOString();
      if (op.action === 'create' || op.action === 'rename') {
        const name = tagName(op.name);
        if (remote.tags.some((t) => t.normalizedName === name.normalizedName && t.id !== op.id))
          return route.fulfill({
            status: 409,
            json: { error: 'A tag with this name already exists.' },
          });
        const old = remote.tags.find((t) => t.id === op.id);
        if (old) Object.assign(old, name, { updatedAt: now });
        else remote.tags.push({ id: op.id, ...name, createdAt: now, updatedAt: now });
      } else if (op.action === 'delete') {
        remote.tags = remote.tags.filter((t) => t.id !== op.id);
        for (const e of remote.entries) {
          e.tags = e.tags?.filter((t) => t.id !== op.id);
          e.updatedAt = now;
        }
      } else {
        for (const entry of remote.entries.filter((e) => op.entryIds.includes(e.id))) {
          entry.tags = entry.tags?.filter((t) => t.id !== op.tagId) ?? [];
          if (!op.remove) entry.tags.push(remote.tags.find((t) => t.id === op.tagId)!);
          entry.updatedAt = now;
        }
      }
    }
    return route.fulfill({ json: { tags: remote.tags } });
  });
  return remote;
}
export async function seed(remote: Remote, count: number) {
  for (let i = 0; i < count; i++) {
    const now = new Date(Date.now() - 60000).toISOString(),
      segment = demo.segments[(i + 1) % demo.segments.length];
    const entry: DictionaryEntry = {
      schemaVersion: 1,
      id: 'word-' + i,
      term: ['朝', '空', '静か', '散歩'][i] ?? '語' + i,
      reading: null,
      normalizedTerm: 'term-' + i,
      translation: 'Meaning ' + i,
      sourceSentence: segment.japanese,
      sourceSentenceTranslation: segment.translation,
      source: await dictionarySource(demo as Lesson, segment),
      createdAt: now,
      updatedAt: now,
    };
    remote.entries.push(entry);
    remote.review = applyLocalReview(remote.review, {
      action: 'enroll',
      entryIds: [entry.id],
      deckId: 'inbox',
      enrolledAt: now,
    });
  }
}
