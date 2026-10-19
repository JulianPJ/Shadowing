import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createAuth, handleAuthRequest, type AuthMail } from '../src/lib/auth/server';
import { adultConfirmed, hasAdultSelfDeclaration } from '../src/lib/auth/eligibility';
import { createD1AccessRepository, requirePro } from '../src/lib/access';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';
import { accountHandler } from '../src/lib/sync/server';
import { emptySync } from '../src/lib/sync/types';
import type { D1Database } from '../src/lib/d1';

const env = {
  AUTH_SECRET: 'adult-eligibility-test-secret-32-characters',
  AUTH_BASE_URL: 'https://eligibility.example',
  GOOGLE_CLIENT_ID: 'mock-google-client',
  GOOGLE_CLIENT_SECRET: 'mock-google-secret',
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'adult-eligibility-test' },
  }),
);
const mail: AuthMail[] = [];
let db: D1Database, auth: ReturnType<typeof createAuth>, api: ReturnType<typeof accountHandler>;
let ipCounter = 0;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
function request(path: string, body?: unknown, cookie = '') {
  return new Request(`${env.AUTH_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: env.AUTH_BASE_URL,
      'Content-Type': 'application/json',
      cookie,
      // A fresh client address per request keeps Better Auth's sign-up rate limit out of the way.
      'cf-connecting-ip': `198.51.100.${++ipCounter}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const users = async (email: string) =>
  (
    await db
      .prepare('SELECT COUNT(*) n FROM "user" WHERE email=?')
      .bind(email)
      .first<{ n: number }>()
  )?.n ?? 0;
const declaredAt = async (email: string) =>
  (
    await db
      .prepare('SELECT adultSelfDeclaredAt FROM "user" WHERE email=?')
      .bind(email)
      .first<{ adultSelfDeclaredAt: unknown }>()
  )?.adultSelfDeclaredAt;
const signUp = (email: string, extra: Record<string, unknown>) =>
  handleAuthRequest(
    request('/api/auth/sign-up/email', {
      email,
      password: 'a long eligibility password',
      name: 'Learner',
      callbackURL: '/account',
      ...extra,
    }),
    auth,
    env,
  );
async function signIn(email: string) {
  const message = mail.findLast((m) => m.to === email)!;
  assert.ok(message, 'verification email sent');
  const verified = await auth.handler(
    new Request(message.text.slice(message.text.indexOf('https://'))),
  );
  assert.equal(verified.status, 302);
  return cookies(verified);
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
  api = accountHandler({
    auth,
    progress: createD1UserProgressRepository(db),
    env,
    db,
    access: createD1AccessRepository(db),
  });
  const context = await auth.$context;
  assert.ok(Array.isArray(context.socialProviders));
  const google = context.socialProviders.find((p) => p.id === 'google')!;
  google.validateAuthorizationCode = async () => ({
    accessToken: 'mock-access-token',
    scopes: ['openid', 'email', 'profile'],
  });
  google.getUserInfo = async () => ({
    user: { name: 'Google learner', email: 'google@example.com', emailVerified: true },
    data: { sub: 'mock-google-eligibility-sub' },
  });
});
after(() => mf.dispose());

test('only an explicit boolean confirmation counts and stored declarations are recognised', () => {
  assert.equal(adultConfirmed({ adultConfirmed: true }), true);
  for (const value of [undefined, null, false, 'true', 1, 'yes', {}])
    assert.equal(adultConfirmed({ adultConfirmed: value }), false);
  assert.equal(adultConfirmed(null), false);
  assert.equal(hasAdultSelfDeclaration({ adultSelfDeclaredAt: new Date() }), true);
  assert.equal(hasAdultSelfDeclaration({ adultSelfDeclaredAt: new Date('invalid') }), false);
  assert.equal(hasAdultSelfDeclaration({ adultSelfDeclaredAt: null }), false);
  assert.equal(hasAdultSelfDeclaration({}), false);
});

test('email registration without an explicit 18+ confirmation creates no account and sends no email', async () => {
  for (const [index, extra] of [
    {},
    { adultConfirmed: false },
    { adultConfirmed: 'true' },
    { adultConfirmed: 1 },
  ].entries()) {
    const email = `blocked-${index}@example.com`;
    const response = await signUp(email, extra);
    assert.equal(response.status, 403, JSON.stringify(extra));
    assert.equal((await response.json()).code, 'ADULT_CONFIRMATION_REQUIRED');
    assert.equal(await users(email), 0);
    assert.equal(
      mail.some((m) => m.to === email),
      false,
    );
  }
  // The stored timestamp is server-owned; a client cannot write it, with or without confirming.
  const forged = await signUp('forged@example.com', {
    adultConfirmed: true,
    adultSelfDeclaredAt: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(forged.status, 400);
  assert.equal(await users('forged@example.com'), 0);
});

test('confirmed email registration records a self-declaration timestamp and no date of birth', async () => {
  const before = Date.now();
  const response = await signUp('adult@example.com', { adultConfirmed: true });
  assert.equal(response.status, 200);
  const stored = await declaredAt('adult@example.com');
  assert.ok(stored);
  const time = typeof stored === 'number' ? stored : Date.parse(String(stored));
  assert.ok(time >= before - 1000 && time <= Date.now() + 1000);
  const columns = await db.prepare('PRAGMA table_info("user")').all<{ name: string }>();
  assert.equal(
    columns.results.some((c) => /birth|^dob$|^age$/i.test(c.name)),
    false,
  );
  const cookie = await signIn('adult@example.com');
  const me = await (await api(request('/api/account/me', undefined, cookie))).json();
  assert.equal(me.user.adultConfirmed, true);
  assert.equal((await api(request('/api/sync/bootstrap', undefined, cookie))).status, 200);
});

test('user creation outside a confirmed sign-up flow is refused by the database hook', async () => {
  const context = await auth.$context;
  await assert.rejects(
    context.internalAdapter.createUser(
      { name: 'Direct', email: 'direct@example.com', emailVerified: true },
      { method: 'admin' },
    ),
  );
  assert.equal(await users('direct@example.com'), 0);
});

async function googleFlow(body: Record<string, unknown>) {
  const started = await auth.handler(
    request('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: '/account',
      errorCallbackURL: '/register',
      ...body,
    }),
  );
  if (started.status !== 200) return { started, callback: null };
  const state = new URL((await started.json()).url).searchParams.get('state');
  assert.ok(state);
  const callback = await auth.handler(
    request(
      `/api/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      undefined,
      cookies(started),
    ),
  );
  return { started, callback };
}

test('Google cannot create an account without the registration 18+ confirmation', async () => {
  // Sign-in (no sign-up request) never creates an account, even with spoofed client state.
  for (const body of [
    {},
    { additionalData: { adultConfirmed: true } },
    { additionalData: { serverContext: { adultSelfDeclaredAt: Date.now() } } },
  ]) {
    const { callback } = await googleFlow(body);
    assert.equal(callback?.status, 302);
    assert.match(callback!.headers.get('location')!, /error=signup_disabled/);
    assert.equal(await users('google@example.com'), 0);
  }
  // Sign-up requests must carry an explicit confirmation before Google is even contacted.
  for (const additionalData of [undefined, {}, { adultConfirmed: 'true' }]) {
    const { started } = await googleFlow({ requestSignUp: true, additionalData });
    assert.equal(started.status, 403);
    assert.equal((await started.json()).code, 'ADULT_CONFIRMATION_REQUIRED');
  }
  assert.equal(await users('google@example.com'), 0);
});

test('Google registration with confirmation records the self-declaration from server state', async () => {
  const { started, callback } = await googleFlow({
    requestSignUp: true,
    additionalData: { adultConfirmed: true },
  });
  assert.equal(started.status, 200);
  assert.equal(callback?.status, 302);
  assert.equal(new URL(callback!.headers.get('location')!, env.AUTH_BASE_URL).pathname, '/account');
  assert.equal(await users('google@example.com'), 1);
  assert.ok(await declaredAt('google@example.com'));
  const me = await (await api(request('/api/account/me', undefined, cookies(callback!)))).json();
  assert.equal(me.user.email, 'google@example.com');
  assert.equal(me.user.adultConfirmed, true);
  // Signing in again later needs no new sign-up request.
  const again = await googleFlow({});
  assert.equal(
    new URL(again.callback!.headers.get('location')!, env.AUTH_BASE_URL).pathname,
    '/account',
  );
});

test('existing accounts keep their data, can export it, and regain access only after confirming', async () => {
  assert.equal((await signUp('existing@example.com', { adultConfirmed: true })).status, 200);
  const cookie = await signIn('existing@example.com');
  const me = await (await api(request('/api/account/me', undefined, cookie))).json();
  const userId: string = me.user.id;
  const preferences = {
    schemaVersion: 1,
    mode: 'continuous',
    speed: 0.75,
    studioMode: true,
    furigana: true,
    updatedAt: new Date().toISOString(),
  };
  const pushed = await api(request('/api/sync/push', { ...emptySync(), preferences }, cookie));
  assert.equal(pushed.status, 200, await pushed.clone().text());
  // Simulate an account created before the 18+ policy existed (the migration leaves it NULL).
  await db.prepare('UPDATE "user" SET adultSelfDeclaredAt=NULL WHERE id=?').bind(userId).run();

  const pending = await (await api(request('/api/account/me', undefined, cookie))).json();
  assert.equal(pending.user.adultConfirmed, false);
  for (const [path, body] of [
    ['/api/sync/bootstrap', undefined],
    ['/api/sync/push', { ...emptySync(), preferences }],
    ['/api/watch-later', undefined],
  ] as const) {
    const blocked = await api(request(path, body, cookie));
    assert.equal(blocked.status, 403, path);
    assert.equal((await blocked.json()).code, 'adult-confirmation-required');
  }
  await db
    .prepare('INSERT INTO user_access (user_id,plan,source,updated_at) VALUES (?,?,?,?)')
    .bind(userId, 'pro', 'test', new Date().toISOString())
    .run();
  const pro = await requirePro(
    request('/api/quiz', {}, cookie),
    auth,
    createD1AccessRepository(db),
  );
  assert.equal(pro?.status, 403);
  assert.equal((await pro!.json()).code, 'adult-confirmation-required');

  const exported = await api(request('/api/account/export', undefined, cookie));
  assert.equal(exported.status, 200);
  assert.equal((await exported.json()).learning.preferences.speed, 0.75);

  for (const body of [{}, { adultConfirmed: 'true' }, { adultConfirmed: true, extra: 1 }])
    assert.equal(
      (await api(request('/api/account/eligibility', body, cookie))).status,
      400,
      JSON.stringify(body),
    );
  assert.equal(
    (await api(request('/api/account/eligibility', { adultConfirmed: true }))).status,
    401,
  );
  const confirmed = await api(
    request('/api/account/eligibility', { adultConfirmed: true }, cookie),
  );
  assert.equal(confirmed.status, 200);
  assert.ok(await declaredAt('existing@example.com'));
  const after = await (await api(request('/api/account/me', undefined, cookie))).json();
  assert.equal(after.user.adultConfirmed, true);
  const restored = await (await api(request('/api/sync/bootstrap', undefined, cookie))).json();
  assert.equal(restored.data.preferences.speed, 0.75);
  assert.equal(
    await requirePro(request('/api/quiz', {}, cookie), auth, createD1AccessRepository(db)),
    null,
  );
});
