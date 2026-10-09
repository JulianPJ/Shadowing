import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  allowedAuthRedirect,
  createAuth,
  handleAuthRequest,
  type AuthMail,
} from '../src/lib/auth/server';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';
import { accountHandler } from '../src/lib/sync/server';
import { emptySync, type SyncData } from '../src/lib/sync/types';
import { mergeSync } from '../src/lib/sync/merge';
import { validateSync } from '../src/lib/sync/validation';
import { sanitizeDeviceData } from '../src/lib/sync/sanitize';
import { lessonIdentity } from '../src/lib/learner/constants';
import { createSession } from '../src/lib/learner/sessions';
import { transcriptKey } from '../src/lib/transcript';
import { createQuiz } from '../src/lib/quiz/document';
import { newAttempt, updateAttempt } from '../src/lib/quiz/attempts';
import { verifyAttempt } from '../src/lib/sync/quiz-verification';
import demo from '../src/data/demo.json';
import demoQuiz from '../src/data/demo-quiz.json';
import type { D1Database } from '../src/lib/d1';
import type { Lesson } from '../src/lib/types';
import { createD1AccessRepository, requirePro } from '../src/lib/access';
const env = {
  AUTH_SECRET: 'deterministic-test-secret-at-least-32-characters',
  AUTH_BASE_URL: 'https://hibiki.example',
  GOOGLE_CLIENT_ID: 'mock-google-client',
  GOOGLE_CLIENT_SECRET: 'mock-google-secret',
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'auth-sync-test' },
  }),
);
const mail: AuthMail[] = [];
let db: D1Database,
  auth: ReturnType<typeof createAuth>,
  repo: ReturnType<typeof createD1UserProgressRepository>,
  access: ReturnType<typeof createD1AccessRepository>,
  api: ReturnType<typeof accountHandler>;
let cookieA = '',
  cookieB = '',
  userA = '',
  userB = '',
  data: SyncData;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
function request(path: string, body?: unknown, cookie = '', ip = '192.0.2.1') {
  return new Request(`${env.AUTH_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      origin: env.AUTH_BASE_URL,
      'Content-Type': 'application/json',
      cookie,
      'cf-connecting-ip': ip,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  for (const file of (await readdir('migrations')).sort()) {
    const sql = await readFile(`migrations/${file}`, 'utf8');
    await db.batch(
      sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
  auth = createAuth(db, env, undefined, async (message) => {
    mail.push(message);
  });
  repo = createD1UserProgressRepository(db);
  access = createD1AccessRepository(db);
  api = accountHandler({ auth, progress: repo, env, db, access });
  data = emptySync();
  const key = await transcriptKey(demo),
    identity = lessonIdentity(demo as Lesson, key),
    now = new Date().toISOString();
  data.preferences = {
    schemaVersion: 1,
    mode: 'continuous',
    speed: 0.75,
    studioMode: true,
    furigana: true,
    updatedAt: now,
  };
  data.sessions = [createSession(identity, now)];
  data.lessons = [
    {
      id: JSON.stringify(['demo', key]),
      lesson: identity,
      contentKey: null,
      providerMediaId: null,
      mediaAvailable: true,
      lastSectionId: demo.segments[2].id,
      position: 2,
      updatedAt: now,
      completed: true,
      completedAt: now,
    },
  ];
  data.bookmarks = [
    {
      id: JSON.stringify(['demo', key, demo.segments[1].id]),
      lesson: identity,
      sectionId: demo.segments[1].id,
      start: demo.segments[1].start,
      end: demo.segments[1].end,
      updatedAt: now,
      deleted: false,
    },
  ];
});
after(() => mf.dispose());
test('email delivery endpoints fail clearly before account creation when mail is unavailable', async () => {
  const authWithoutMail = createAuth(db, env);
  const response = await handleAuthRequest(
    request(
      '/api/auth/sign-up/email',
      {
        email: 'unconfigured-mail@example.com',
        password: 'a long test password',
        name: 'Learner',
        callbackURL: '/account',
      },
      '',
      '192.0.2.99',
    ),
    authWithoutMail,
    env,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: 'EMAIL_SERVICE_UNAVAILABLE',
    message: 'Email authentication is awaiting email service setup.',
  });
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) n FROM "user" WHERE email=?')
        .bind('unconfigured-mail@example.com')
        .first<{ n: number }>()
    )?.n,
    0,
  );
});

test('framework email registration, verification, persistent session and sign in', async () => {
  for (const [email, ip] of [
    ['a@example.com', '192.0.2.1'],
    ['b@example.com', '192.0.2.2'],
  ]) {
    const registered = await handleAuthRequest(
      request(
        '/api/auth/sign-up/email',
        { email, password: 'a long test password', name: 'Learner', callbackURL: '/account' },
        '',
        ip,
      ),
      auth,
      env,
    );
    assert.equal(registered.status, 200);
    const message = mail.find((m) => m.to === email)!;
    assert.ok(message);
    const verified = await auth.handler(
      new Request(message.text.slice(message.text.indexOf('https://'))),
    );
    assert.equal(verified.status, 302);
    assert.ok(cookies(verified));
    const signed = await handleAuthRequest(
      request(
        '/api/auth/sign-in/email',
        { email, password: 'a long test password', callbackURL: '/account' },
        '',
        ip,
      ),
      auth,
      env,
    );
    assert.equal(signed.status, 200);
    const cookie = cookies(signed);
    assert.ok(cookie.includes('session_token='));
    assert.match(signed.headers.get('set-cookie')!, /HttpOnly/i);
    assert.match(signed.headers.get('set-cookie')!, /Secure/i);
    const me = await (await api(request('/api/account/me', undefined, cookie, ip))).json();
    assert.equal(me.user.email, email);
    assert.equal(me.user.plan, 'free');
    if (email.startsWith('a')) {
      cookieA = cookie;
      userA = me.user.id;
    } else {
      cookieB = cookie;
      userB = me.user.id;
    }
  }
  assert.notEqual(userA, userB);
});
test('real email sign-in accepts validated learning callbacks and rejects external or privileged paths', async () => {
  const destination = '/practice/demo?section=segment-2&lookup=%E6%97%A5%E6%9C%AC%E8%AA%9E';
  assert.equal(allowedAuthRedirect(destination, env.AUTH_BASE_URL), true);
  assert.equal(allowedAuthRedirect('/dictionary?view=decks', env.AUTH_BASE_URL), true);
  assert.equal(allowedAuthRedirect('/profile', env.AUTH_BASE_URL), true);
  for (const invalid of [
    'https://evil.example/account',
    '/api/auth/sign-out',
    '/practice/demo%0a',
    '/\\evil.example',
    'javascript:alert(1)',
  ])
    assert.equal(allowedAuthRedirect(invalid, env.AUTH_BASE_URL), false);
  const response = await handleAuthRequest(
    request(
      '/api/auth/sign-in/email',
      { email: 'a@example.com', password: 'a long test password', callbackURL: destination },
      '',
      '192.0.2.80',
    ),
    auth,
    env,
  );
  assert.equal(response.status, 200);
  assert.ok(cookies(response).includes('session_token='));
});

test('entitlements default Free, expose Pro from D1, and guard paid server routes', async () => {
  assert.equal(await access.plan(userA), 'free');
  assert.equal(await access.plan(userB), 'free');

  await db
    .prepare('INSERT INTO user_access (user_id,plan,source,updated_at) VALUES (?,?,?,?)')
    .bind(userA, 'pro', 'test', new Date().toISOString())
    .run();

  assert.equal(await access.plan(userA), 'pro');
  const proMe = await (await api(request('/api/account/me', undefined, cookieA))).json();
  const freeMe = await (await api(request('/api/account/me', undefined, cookieB))).json();
  assert.equal(proMe.user.plan, 'pro');
  assert.equal(freeMe.user.plan, 'free');

  assert.equal(await requirePro(request('/api/quiz'), auth, access).then((r) => r?.status), 401);
  assert.equal(
    await requirePro(request('/api/quiz', undefined, cookieB), auth, access).then((r) => r?.status),
    403,
  );
  assert.equal(await requirePro(request('/api/quiz', undefined, cookieA), auth, access), null);
});

test('native D1 retains bounded review limits across preference writes from two client versions', async () => {
  const owner = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(owner, 'Limits learner', `${owner}@example.com`)
    .run();
  const stamp = Date.now();
  const preferences = {
    schemaVersion: 1 as const,
    mode: 'shadowing' as const,
    speed: 1,
    studioMode: false,
    furigana: false,
    updatedAt: new Date(stamp).toISOString(),
  };
  await repo.push(owner, { ...emptySync(), preferences });
  assert.equal((await repo.bootstrap(owner)).data.preferences?.reviewLimits, undefined);
  const reviewLimits = {
    defaults: { new: 20, review: 100 },
    decks: { inbox: { new: 5, review: 20 } },
  };
  await repo.push(owner, {
    ...emptySync(),
    preferences: { ...preferences, reviewLimits, updatedAt: new Date(stamp + 1).toISOString() },
  });
  assert.deepEqual((await repo.bootstrap(owner)).data.preferences?.reviewLimits, reviewLimits);
  await repo.push(owner, {
    ...emptySync(),
    preferences: {
      ...preferences,
      mode: 'continuous',
      updatedAt: new Date(stamp + 2).toISOString(),
    },
  });
  const restored = (await repo.bootstrap(owner)).data.preferences;
  assert.equal(restored?.mode, 'continuous');
  assert.deepEqual(restored?.reviewLimits, reviewLimits);
  assert.equal((await repo.bootstrap(`${owner}-other`)).data.preferences, null);
});

test('sync session-derived ownership, cross-user isolation and forged body owner rejection', async () => {
  assert.equal((await api(request('/api/sync/bootstrap'))).status, 401);
  assert.equal((await api(request('/api/sync/push', data))).status, 401);
  const staleTab = request('/api/sync/push', data, cookieB);
  staleTab.headers.set('X-Hibiki-Account', userA);
  assert.equal((await api(staleTab)).status, 409);
  assert.equal(
    (await api(request('/api/sync/push', { ...data, userId: userB }, cookieA))).status,
    400,
  );
  assert.equal((await api(request('/api/sync/push', data, cookieA))).status, 200);
  assert.equal((await api(request('/api/sync/push', data, cookieA))).status, 200);
  assert.equal((await repo.bootstrap(userA)).data.lessons.length, 1);
  assert.equal((await repo.bootstrap(userB)).data.lessons.length, 0);
  const result = await (
    await api(request('/api/sync/bootstrap?userId=' + userA, undefined, cookieB))
  ).json();
  assert.equal(result.data.lessons.length, 0);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) n FROM user_practice_sessions WHERE user_id=?')
        .bind(userA)
        .first<{ n: number }>()
    )?.n,
    1,
  );
});
test('stale position cannot revert completion, bookmark tombstones win, and immutable IDs are protected', async () => {
  const stale = structuredClone(data);
  stale.lessons[0].position = 0;
  stale.lessons[0].completed = false;
  stale.lessons[0].completedAt = null;
  stale.lessons[0].updatedAt = new Date(0).toISOString();
  await repo.push(userA, stale);
  const loaded = (await repo.bootstrap(userA)).data.lessons[0];
  assert.equal(loaded.position, 2);
  assert.equal(loaded.completed, true);
  const deletion = emptySync();
  deletion.bookmarks = [{ ...data.bookmarks[0], deleted: true }];
  await repo.push(userA, deletion);
  await repo.push(userA, { ...emptySync(), bookmarks: data.bookmarks });
  const rows = await db
    .prepare('SELECT payload_json FROM user_bookmarks WHERE user_id=?')
    .bind(userA)
    .all<{ payload_json: string }>();
  assert.equal(JSON.parse(rows.results[0].payload_json).deleted, true);
  const changed = { ...emptySync(), sessions: structuredClone(data.sessions) };
  changed.sessions[0].lesson.lessonId = 'different';
  await assert.rejects(repo.push(userA, changed), /Immutable/);
  const combined = mergeSync(data, stale);
  assert.equal(combined.lessons[0].completed, true);
  assert.equal(combined.sessions.length, 1);
});
test('server recomputes shared quiz scores, strips evidence text, and retains distinct retakes', async () => {
  const quiz = await createQuiz(demoQuiz, demo),
    a = updateAttempt(
      newAttempt(quiz, demo),
      quiz,
      quiz.questions.map((q) => q.correctIndex),
      true,
    );
  const wire = {
    schemaVersion: 1,
    id: a.id,
    lessonId: a.lessonId,
    quizId: a.quizId,
    transcriptKey: a.transcriptKey,
    contentKey: null,
    startedAt: a.startedAt,
    updatedAt: a.updatedAt,
    completedAt: a.completedAt,
    totalQuestions: a.totalQuestions,
    score: 0,
    verified: false,
    results: a.results.map(({ evidence, ...r }) => ({
      ...r,
      correctIndex: (r.selectedIndex + 1) % 4,
      correct: false,
      evidence: { segmentIds: evidence.segmentIds, start: evidence.start, end: evidence.end },
    })),
  };
  const normalized = validateSync({ ...emptySync(), attempts: [wire] }).attempts[0];
  const verified = await verifyAttempt(normalized, db);
  assert.equal(verified.score, quiz.questions.length);
  assert.equal(verified.verified, true);
  assert.ok(!JSON.stringify(verified).includes('quote'));
  const pushed = await api(
    request(
      '/api/sync/push',
      { ...emptySync(), attempts: [wire, { ...wire, id: crypto.randomUUID() }] },
      cookieA,
    ),
  );
  assert.equal(pushed.status, 200);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) n FROM user_quiz_attempts WHERE user_id=?')
        .bind(userA)
        .first<{ n: number }>()
    )?.n,
    2,
  );
});
test('unsafe fields, playback secrets, private text, future timestamps and cross-origin writes rejected', async () => {
  for (const attack of [
    { ...data, recordings: ['audio'] },
    { ...data, lessons: [{ ...data.lessons[0], mediaUrl: 'https://example.com/?token=secret' }] },
    { ...data, sessions: [{ ...data.sessions[0], transcript: 'private' }] },
    { ...data, preferences: { ...data.preferences, updatedAt: '2099-01-01T00:00:00.000Z' } },
  ])
    assert.equal((await api(request('/api/sync/push', attack, cookieA))).status, 400);
  const evil = request('/api/sync/push', data, cookieA);
  evil.headers.set('origin', 'https://evil.example');
  assert.equal((await api(evil)).status, 403);
  assert.equal(
    (
      await handleAuthRequest(
        request(
          '/api/auth/sign-in/social',
          { provider: 'google', callbackURL: 'https://evil.example' },
          cookieA,
        ),
        auth,
        env,
      )
    ).status,
    400,
  );
});
test('user-scoped keyset pagination and indexed queries', async () => {
  const base = data.lessons[0],
    many = emptySync();
  for (let i = 0; i < 50; i++)
    many.lessons.push({
      ...base,
      id: JSON.stringify([`lesson-${i}`, base.lesson.transcriptKey]),
      lesson: { ...base.lesson, lessonId: `lesson-${i}` },
    });
  await repo.push(userA, many);
  const page = await repo.bootstrap(userA);
  assert.equal(page.data.lessons.length, 50);
  assert.ok(page.nextCursor);
  const second = await repo.bootstrap(userA, page.nextCursor);
  assert.equal(second.data.lessons.length, 1);
  const plan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT id FROM user_lessons WHERE user_id=? AND id>? ORDER BY id LIMIT 51',
    )
    .bind(userA, '')
    .all<{ detail: string }>();
  assert.ok(plan.results.every((r) => !r.detail.includes('SCAN')));
});
test('mocked Google OAuth uses framework state and PKCE, requires explicit linking and keeps one user', async () => {
  const context = await auth.$context;
  assert.ok(Array.isArray(context.socialProviders));
  const google = context.socialProviders.find((p) => p.id === 'google')!;
  let exchanges = 0;
  google.validateAuthorizationCode = async ({ codeVerifier, code }) => {
    assert.ok(codeVerifier && codeVerifier.length >= 32);
    assert.equal(code, 'mock-code');
    exchanges++;
    return { accessToken: 'mock-access-token', scopes: ['openid', 'email', 'profile'] };
  };
  google.getUserInfo = async () => ({
    user: { name: 'Mock learner', email: 'a@example.com', emailVerified: true },
    data: { sub: 'mock-google-sub' },
  });
  async function oauth(path: string, cookie: string, ip: string) {
    const started = await auth.handler(
      request(
        path,
        { provider: 'google', callbackURL: '/account', errorCallbackURL: '/sign-in' },
        cookie,
        ip,
      ),
    );
    assert.equal(started.status, 200);
    const url = new URL((await started.json()).url);
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const state = url.searchParams.get('state');
    assert.ok(state);
    const callback = request(
      `/api/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      undefined,
      [cookie, cookies(started)].filter(Boolean).join('; '),
      ip,
    );
    return auth.handler(callback);
  }
  const implicit = await oauth('/api/auth/sign-in/social', '', '192.0.2.30');
  assert.equal(implicit.status, 302);
  assert.match(implicit.headers.get('location')!, /account_not_linked/);
  const linked = await oauth('/api/auth/link-social', cookieA, '192.0.2.31');
  assert.equal(linked.status, 302);
  assert.equal(new URL(linked.headers.get('location')!, env.AUTH_BASE_URL).pathname, '/account');
  const row = await db
    .prepare('SELECT userId FROM account WHERE providerId=? AND accountId=?')
    .bind('google', 'mock-google-sub')
    .first<{ userId: string }>();
  assert.equal(row?.userId, userA);
  const signed = await oauth('/api/auth/sign-in/social', '', '192.0.2.32');
  assert.equal(signed.status, 302);
  const me = await (await api(request('/api/account/me', undefined, cookies(signed)))).json();
  assert.equal(me.user.id, userA);
  const failed = await oauth('/api/auth/link-social', cookieB, '192.0.2.33');
  assert.match(failed.headers.get('location')!, /error=/);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) n FROM "user" WHERE email=?')
        .bind('a@example.com')
        .first<{ n: number }>()
    )?.n,
    1,
  );
  const invalid = await auth.handler(
    request('/api/auth/callback/google?code=mock-code&state=forged', undefined, cookieA),
  );
  assert.equal(invalid.status, 302);
  assert.equal(exchanges, 4);
});
test('email password reset rejects invalid tokens and revokes existing sessions', async () => {
  const reset = await handleAuthRequest(
    request(
      '/api/auth/request-password-reset',
      {
        email: 'b@example.com',
        redirectTo: '/reset-password',
      },
      '',
      '192.0.2.40',
    ),
    auth,
    env,
  );
  assert.equal(reset.status, 200);
  const message = mail.findLast((m) => m.to === 'b@example.com' && m.subject.includes('Reset'))!;
  assert.ok(message);
  const action = new URL(message.text.slice(message.text.indexOf('https://')));
  const token = action.pathname.split('/').at(-1)!;
  const invalid = await auth.handler(
    request(
      '/api/auth/reset-password',
      {
        token: 'invalid-token',
        newPassword: 'another long test password',
      },
      '',
      '192.0.2.41',
    ),
  );
  assert.equal(invalid.status, 400);
  const changed = await auth.handler(
    request(
      '/api/auth/reset-password',
      {
        token,
        newPassword: 'another long test password',
      },
      '',
      '192.0.2.42',
    ),
  );
  assert.equal(changed.status, 200);
  assert.equal((await api(request('/api/sync/bootstrap', undefined, cookieB))).status, 401);
  const signed = await auth.handler(
    request(
      '/api/auth/sign-in/email',
      {
        email: 'b@example.com',
        password: 'another long test password',
      },
      '',
      '192.0.2.43',
    ),
  );
  assert.equal(signed.status, 200);
  cookieB = cookies(signed);
  assert.equal((await api(request('/api/sync/bootstrap', undefined, cookieB))).status, 200);
});

test('device snapshots discard private fields and unsafe records before transport', () => {
  const candidate = structuredClone(data);
  candidate.lessons.push({
    ...candidate.lessons[0],
    mediaUrl: 'https://private.example/?token=SECRET',
  } as never);
  candidate.sessions.push({
    ...candidate.sessions[0],
    lastSectionId: 'C:\\private\\transcript.txt',
  });
  candidate.attempts.push({
    ...candidate.attempts[0],
    privateTranscript: 'PRIVATE_TRANSCRIPT',
  } as never);
  const safe = sanitizeDeviceData(candidate);
  assert.equal(safe.lessons.length, data.lessons.length);
  assert.equal(safe.sessions.length, data.sessions.length);
  assert.equal(safe.attempts.length, data.attempts.length);
  assert.doesNotMatch(JSON.stringify(safe), /SECRET|PRIVATE_TRANSCRIPT|private\\\\transcript/);
  assert.equal(sanitizeDeviceData(null).sessions.length, 0);
});

test('invalid/expired sessions and sign out reject authenticated endpoints', async () => {
  assert.equal(
    (
      await api(
        request('/api/sync/bootstrap', undefined, '__Secure-better-auth.session_token=forged'),
      )
    ).status,
    401,
  );
  const signedOut = await auth.handler(request('/api/auth/sign-out', {}, cookieA));
  assert.equal(signedOut.status, 200);
  assert.equal((await api(request('/api/sync/bootstrap', undefined, cookieA))).status, 401);
  await db.prepare('UPDATE session SET expiresAt=0 WHERE userId=?').bind(userB).run();
  assert.equal((await api(request('/api/sync/bootstrap', undefined, cookieB))).status, 401);
});
