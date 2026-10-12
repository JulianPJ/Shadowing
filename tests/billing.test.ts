import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createAuth } from '../src/lib/auth/server';
import { createD1AccessRepository, requirePro } from '../src/lib/access';
import type { D1Database } from '../src/lib/d1';
import { billingHandler } from '../src/lib/billing/server';
import { paddleWebhook } from '../src/lib/billing/webhook';
import { BillingRepository } from '../src/lib/billing/repository';
import { paddleApi, type PaddleRequest } from '../src/lib/billing/paddle';
import { billingEnvironment, billingConfigured } from '../src/lib/billing/config';
import { verifyPaddleSignature } from '../src/lib/billing/signature';

const id = (prefix: string, char = 'a') => `${prefix}_${char.repeat(26)}`;
const settings = {
  AUTH_BASE_URL: 'https://billing.example',
  AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
  PADDLE_ENABLED: 'true',
  PADDLE_API_KEY: 'server-only-api-key',
  PADDLE_CLIENT_TOKEN: 'test_client-token',
  PADDLE_WEBHOOK_SECRET: 'server-only-notification-secret',
  PADDLE_PRO_MONTHLY_PRICE_ID: id('pri'),
  PADDLE_PRO_ANNUAL_PRICE_ID: id('pri', 'b'),
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'paddle-billing-tests' },
  }),
);
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
let userId: string;
let cookie: string;
let verifiedCookie: string;
let clock = Date.now();
let sequence = 0;
const now = () => clock;
const apiCalls: { path: string; body: unknown }[] = [];
let transaction: Record<string, unknown>;
let providerFails = false;
let pricing: Record<string, unknown>;
let nextTransaction = id('txn');
const api: PaddleRequest = async (path, body) => {
  apiCalls.push({ path, body });
  if (providerFails) throw new Error('provider down');
  if (path.endsWith('/portal-sessions'))
    return {
      urls: {
        general: { overview: 'https://sandbox-customer-portal.paddle.com/session?token=temporary' },
      },
    };
  if (path === '/transactions') return { id: nextTransaction };
  if (path === '/pricing-preview') return pricing;
  if (path.startsWith('/transactions/')) return transaction;
  throw new Error('Unexpected Paddle call');
};
function request(
  path: string,
  body?: unknown,
  options: { cookie?: string; owner?: string; origin?: string } = {},
) {
  return new Request(`${settings.AUTH_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: options.origin ?? settings.AUTH_BASE_URL,
      'Content-Type': 'application/json',
      cookie: options.cookie ?? cookie,
      'X-Hibiki-Account': options.owner ?? userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: id('sub'),
    customer_id: id('ctm'),
    status: 'active',
    collection_mode: 'automatic',
    items: [
      {
        price: {
          id: settings.PADDLE_PRO_MONTHLY_PRICE_ID,
          billing_cycle: { interval: 'month', frequency: 1 },
        },
        quantity: 1,
      },
    ],
    custom_data: transaction.custom_data,
    current_billing_period: {
      starts_at: new Date(clock - 1000).toISOString(),
      ends_at: new Date(clock + 30 * 86400_000).toISOString(),
    },
    scheduled_change: null,
    ...overrides,
  };
}
async function signed(
  body: string,
  timestamp = Math.floor(clock / 1000),
  secret = settings.PADDLE_WEBHOOK_SECRET,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}:${body}`));
  return `ts=${timestamp};h1=${Buffer.from(mac).toString('hex')}`;
}
function event(
  type = 'subscription.activated',
  data: Record<string, unknown> = subscription(),
  at = new Date(clock).toISOString(),
) {
  return {
    event_id: `evt_${(++sequence).toString().padStart(26, '0')}`,
    event_type: type,
    occurred_at: at,
    data,
  };
}
async function deliver(payload: ReturnType<typeof event>, header?: string) {
  const body = JSON.stringify(payload);
  return paddleWebhook(
    db,
    settings,
    api,
    now,
  )(
    new Request(`${settings.AUTH_BASE_URL}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Paddle-Signature': header ?? (await signed(body)) },
      body,
    }),
  );
}
async function checkout(interval = 'monthly') {
  const response = await billingHandler(
    db,
    auth,
    settings,
    api,
    now,
  )(request('/api/billing/checkout', { interval }));
  assert.equal(response.status, 200, await response.clone().text());
  const intent = await db
    .prepare('SELECT * FROM billing_checkouts WHERE user_id=?')
    .bind(userId)
    .first<{ id: string }>();
  transaction.custom_data = { hibiki_user_id: userId, hibiki_checkout_id: intent!.id };
  return response;
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
  auth = createAuth(db, settings, undefined, async () => {});
  await auth.handler(
    new Request(`${settings.AUTH_BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { origin: settings.AUTH_BASE_URL, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Billing learner',
        email: 'billing@example.com',
        password: 'billing-test-password-1234',
      }),
    }),
  );
  const user = await db
    .prepare('SELECT id FROM "user" WHERE email=?')
    .bind('billing@example.com')
    .first<{ id: string }>();
  userId = user!.id;
  await db.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').bind(userId).run();
  const signin = await auth.handler(
    new Request(`${settings.AUTH_BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: settings.AUTH_BASE_URL, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'billing@example.com',
        password: 'billing-test-password-1234',
      }),
    }),
  );
  assert.equal(signin.status, 200);
  verifiedCookie = signin.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
});
after(async () => mf.dispose());
beforeEach(async () => {
  clock = Date.now();
  cookie = verifiedCookie;
  providerFails = false;
  apiCalls.length = 0;
  nextTransaction = id('txn');
  await db.batch(
    [
      'billing_subscriptions',
      'billing_adjustments',
      'billing_checkouts',
      'billing_customers',
      'billing_events',
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  await db.prepare('DELETE FROM user_access WHERE user_id=?').bind(userId).run();
  await db.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').bind(userId).run();
  pricing = {
    currency_code: 'EUR',
    details: {
      line_items: [
        [settings.PADDLE_PRO_ANNUAL_PRICE_ID, '9999', '€99.99'],
        [settings.PADDLE_PRO_MONTHLY_PRICE_ID, '999', '€9.99'],
      ].map(([price, total, formatted]) => ({
        price: { id: price },
        totals: { total },
        formatted_totals: { total: formatted },
      })),
    },
  };
  transaction = {
    id: id('txn'),
    subscription_id: id('sub'),
    customer_id: id('ctm'),
    billing_period: {
      starts_at: new Date(clock - 1000).toISOString(),
      ends_at: new Date(clock + 30 * 86400_000).toISOString(),
    },
  };
});

test('sandbox defaults; checkout stays disabled until configured and live tokens must match', () => {
  assert.equal(billingEnvironment({}), 'sandbox');
  assert.equal(billingConfigured({}), false);
  assert.equal(billingConfigured(settings), true);
  assert.equal(billingConfigured({ ...settings, PADDLE_ENVIRONMENT: 'live' }), false);
  assert.throws(() => billingEnvironment({ PADDLE_ENVIRONMENT: 'typo' }));
});

test('checkout requires a real verified Better Auth session, same origin and current account', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'monthly' }, { cookie: '' })))
      .status,
    401,
  );
  assert.equal(
    (
      await handler(
        request(
          '/api/billing/checkout',
          { interval: 'monthly' },
          { origin: 'https://evil.example' },
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handler(
        request('/api/billing/checkout', { interval: 'monthly' }, { owner: 'another-account' }),
      )
    ).status,
    409,
  );
  await db.prepare('UPDATE "user" SET emailVerified=0 WHERE id=?').bind(userId).run();
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'monthly' }))).status,
    403,
  );
  assert.equal(apiCalls.length, 0);
});

test('monthly and annual prices are server-owned; checkout response has no secrets or Pro grant', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'monthly', user_id: 'victim' })))
      .status,
    400,
  );
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'lifetime' }))).status,
    400,
  );
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: ['annual'] }))).status,
    400,
  );
  const response = await checkout('annual');
  const text = await response.text();
  assert.ok(
    !text.includes(settings.PADDLE_API_KEY) && !text.includes(settings.PADDLE_WEBHOOK_SECRET),
  );
  assert.deepEqual((apiCalls[0].body as { items: unknown }).items, [
    { price_id: settings.PADDLE_PRO_ANNUAL_PRICE_ID, quantity: 1 },
  ]);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    (await requirePro(request('/api/quiz'), auth, createD1AccessRepository(db)))?.status,
    403,
  );
});

test('concurrent and repeated checkout attempts reuse one transaction and existing subscriptions block new checkout', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  const responses = await Promise.all([
    handler(request('/api/billing/checkout', { interval: 'monthly' })),
    handler(request('/api/billing/checkout', { interval: 'monthly' })),
  ]);
  assert.ok(responses.some((r) => r.status === 200));
  assert.equal(apiCalls.filter((c) => c.path === '/transactions').length, 1);
  await checkout();
  assert.equal(apiCalls.filter((c) => c.path === '/transactions').length, 1);
  assert.equal((await deliver(event())).status, 200);
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'monthly' }))).status,
    409,
  );
});

test('switching interval replaces a ready checkout and the earlier transaction still links', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  await checkout('annual');
  const first = await db
    .prepare('SELECT id FROM billing_checkouts WHERE user_id=?')
    .bind(userId)
    .first<{ id: string }>();
  nextTransaction = id('txn', 'c');
  const response = await handler(request('/api/billing/checkout', { interval: 'monthly' }));
  assert.equal(response.status, 200, await response.clone().text());
  const transactions = apiCalls.filter((c) => c.path === '/transactions');
  assert.equal(transactions.length, 2);
  assert.deepEqual((transactions[1].body as { items: unknown }).items, [
    { price_id: settings.PADDLE_PRO_MONTHLY_PRICE_ID, quantity: 1 },
  ]);
  const { results } = await db
    .prepare('SELECT 1 FROM billing_checkouts WHERE user_id=? AND expires_at>?')
    .bind(userId, new Date(clock).toISOString())
    .all();
  assert.equal(results.length, 1);
  // The retired annual checkout can still complete: its webhook resolves the original intent.
  transaction.custom_data = { hibiki_user_id: userId, hibiki_checkout_id: first!.id };
  const annual = subscription({
    items: [
      {
        price: {
          id: settings.PADDLE_PRO_ANNUAL_PRICE_ID,
          billing_cycle: { interval: 'year', frequency: 1 },
        },
        quantity: 1,
      },
    ],
  });
  assert.equal((await deliver(event('subscription.activated', annual))).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
});

test('signatures reject forged, changed, old, future and ambiguous timestamps and accept rotated signatures', async () => {
  const payload = event();
  const body = JSON.stringify(payload);
  for (const header of [
    'invalid',
    await signed(body, undefined, 'wrong-secret'),
    await signed(body, Math.floor(clock / 1000) - 10),
    await signed(body, Math.floor(clock / 1000) + 10),
    `ts=1;${await signed(body)}`,
  ]) {
    assert.equal((await deliver(payload, header)).status, 401);
  }
  assert.equal(
    await verifyPaddleSignature(
      `${body} `,
      await signed(body),
      settings.PADDLE_WEBHOOK_SECRET,
      clock,
    ),
    false,
  );
  assert.equal(
    await verifyPaddleSignature(
      body,
      `${await signed(body)};h1=${'0'.repeat(64)}`,
      settings.PADDLE_WEBHOOK_SECRET,
      clock,
    ),
    true,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM billing_events').first<{ n: number }>())?.n,
    0,
  );
});

test('subscription activation and renewal grant Pro through the existing access lookup; sandbox cannot grant live access', async () => {
  await checkout();
  assert.equal((await deliver(event())).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  assert.equal(await createD1AccessRepository(db, 'live').plan(userId), 'free');
  assert.equal(await requirePro(request('/api/quiz'), auth, createD1AccessRepository(db)), null);
  const renewed = subscription({
    current_billing_period: {
      starts_at: new Date(clock - 500).toISOString(),
      ends_at: new Date(clock + 60 * 86400_000).toISOString(),
    },
  });
  assert.equal(
    (await deliver(event('subscription.updated', renewed, new Date(clock + 1).toISOString())))
      .status,
    200,
  );
  const stored = await new BillingRepository(db, 'sandbox').subscription(id('sub'));
  assert.equal(Date.parse(stored!.period_end!), clock + 60 * 86400_000);
});

test('duplicate/concurrent webhooks commit one event and older microsecond events cannot restore canceled access', async () => {
  await checkout();
  const activation = event();
  assert.deepEqual(
    (await Promise.all([deliver(activation), deliver(activation)])).map((r) => r.status),
    [200, 200],
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM billing_events').first<{ n: number }>())?.n,
    1,
  );
  const second = new Date(Math.floor(clock / 1000) * 1000).toISOString().slice(0, 19);
  assert.equal(
    (
      await deliver(
        event(
          'subscription.canceled',
          subscription({ status: 'canceled', current_billing_period: null }),
          `${second}.999999Z`,
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (await deliver(event('subscription.activated', subscription(), `${second}.999998Z`))).status,
    200,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  assert.equal((await deliver(activation)).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});

test('scheduled cancellation keeps the paid period; canceled/past_due/paused/trialing states revoke; payment recovery restores', async () => {
  await checkout();
  const end = new Date(clock + 86400_000).toISOString();
  assert.equal(
    (
      await deliver(
        event(
          'subscription.updated',
          subscription({ scheduled_change: { action: 'cancel', effective_at: end } }),
        ),
      )
    ).status,
    200,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  const row = await db
    .prepare('SELECT paddle_sandbox_until AS until FROM user_access WHERE user_id=?')
    .bind(userId)
    .first<{ until: string }>();
  assert.equal(Date.parse(row!.until), Date.parse(end));
  for (const [i, status] of ['past_due', 'paused', 'trialing'].entries()) {
    assert.equal(
      (
        await deliver(
          event(
            `subscription.${status}`,
            subscription({ status }),
            new Date(clock + i + 1).toISOString(),
          ),
        )
      ).status,
      200,
    );
    assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  }
  assert.equal(
    (
      await deliver(
        event('subscription.activated', subscription(), new Date(clock + 10).toISOString()),
      )
    ).status,
    200,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
});

test('expiry is checked on the existing row even without a cancellation or renewal webhook', async () => {
  await checkout();
  const past = {
    starts_at: new Date(clock - 86400_000).toISOString(),
    ends_at: new Date(clock - 1000).toISOString(),
  };
  assert.equal(
    (await deliver(event('subscription.updated', subscription({ current_billing_period: past }))))
      .status,
    200,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});

test('full refunds revoke their paid period, partial/pending refunds do not, and old refunds do not revoke renewal', async () => {
  await checkout();
  await deliver(event());
  const adjustment = {
    id: id('adj'),
    subscription_id: id('sub'),
    transaction_id: id('txn'),
    customer_id: id('ctm'),
    action: 'refund',
    type: 'partial',
    status: 'approved',
  };
  await deliver(event('adjustment.created', adjustment, new Date(clock + 1).toISOString()));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  await deliver(
    event(
      'adjustment.updated',
      { ...adjustment, type: 'full', status: 'pending_approval' },
      new Date(clock + 2).toISOString(),
    ),
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  assert.equal(
    (
      await deliver(
        event(
          'adjustment.updated',
          { ...adjustment, type: 'full' },
          new Date(clock + 3).toISOString(),
        ),
      )
    ).status,
    200,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  await deliver(event('subscription.updated', subscription(), new Date(clock + 4).toISOString()));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  const renewed = subscription({
    current_billing_period: {
      starts_at: new Date(clock - 500).toISOString(),
      ends_at: new Date(clock + 60 * 86400_000).toISOString(),
    },
  });
  await deliver(event('subscription.updated', renewed, new Date(clock + 5).toISOString()));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  await deliver(
    event('adjustment.updated', { ...adjustment, type: 'full' }, new Date(clock + 6).toISOString()),
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
});

test('refunds before activation stay revoked, chargebacks revoke and stale refund events cannot undo approval', async () => {
  await checkout();
  const adjustment = {
    id: id('adj'),
    subscription_id: id('sub'),
    transaction_id: id('txn'),
    customer_id: id('ctm'),
    action: 'chargeback',
    type: 'partial',
    status: 'approved',
  };
  assert.equal(
    (await deliver(event('adjustment.created', adjustment, new Date(clock + 2).toISOString())))
      .status,
    200,
  );
  assert.equal((await deliver(event())).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  await deliver(
    event(
      'adjustment.updated',
      { ...adjustment, status: 'pending_approval' },
      new Date(clock + 1).toISOString(),
    ),
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});

test('manual and existing Free/Pro test accounts survive subscription activation and cancellation', async () => {
  await db
    .prepare("INSERT INTO user_access(user_id,plan,source,updated_at) VALUES (?,'pro','manual',?)")
    .bind(userId, new Date(clock).toISOString())
    .run();
  await checkout();
  await deliver(event());
  await deliver(
    event(
      'subscription.canceled',
      subscription({ status: 'canceled', current_billing_period: null }),
      new Date(clock + 1).toISOString(),
    ),
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
  const manual = await db
    .prepare('SELECT plan,source FROM user_access WHERE user_id=?')
    .bind(userId)
    .first();
  assert.deepEqual(manual, { plan: 'pro', source: 'manual' });
  assert.equal(
    await createD1AccessRepository(db).plan('2b3c0bb9-ad1a-4df0-97c7-af55a0a9a06a'),
    'free',
  );
  assert.equal(
    await createD1AccessRepository(db).plan('b6d5d358-9b94-469e-9a78-cfd3164ac21c'),
    'pro',
  );
});

test('invalid states/prices/periods/ownership and browser transaction success cannot grant access', async () => {
  await checkout();
  for (const data of [
    subscription({ status: 'unknown' }),
    subscription({ status: 'canceled' }),
    subscription({ current_billing_period: null }),
    subscription({ items: [] }),
    subscription({ customer_id: id('ctm', 'b') }),
    subscription({
      custom_data: {
        hibiki_user_id: 'victim',
        hibiki_checkout_id: (transaction.custom_data as { hibiki_checkout_id: string })
          .hibiki_checkout_id,
      },
    }),
  ]) {
    assert.equal((await deliver(event('subscription.activated', data))).status, 422);
  }
  assert.equal((await deliver(event('transaction.completed', { ...transaction }))).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM billing_subscriptions').first<{ n: number }>())?.n,
    0,
  );
});

test('provider or D1 failures leave events retryable with no partial entitlement or ledger writes', async () => {
  await checkout();
  const payload = event();
  providerFails = true;
  assert.equal((await deliver(payload)).status, 503);
  assert.equal(await new BillingRepository(db, 'sandbox').seen(payload.event_id), false);
  providerFails = false;
  await db.exec(
    "CREATE TRIGGER reject_billing_projection BEFORE INSERT ON user_access BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  assert.equal((await deliver(payload)).status, 503);
  assert.equal(await new BillingRepository(db, 'sandbox').seen(payload.event_id), false);
  assert.equal(await new BillingRepository(db, 'sandbox').subscription(id('sub')), null);
  await db.exec('DROP TRIGGER reject_billing_projection');
  assert.equal((await deliver(payload)).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
});

test('prices are previewed server-side for the configured prices only and fail closed', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  assert.equal(
    (await handler(request('/api/billing/prices', undefined, { cookie: '' }))).status,
    401,
  );
  const localised = request('/api/billing/prices');
  localised.headers.set('CF-Connecting-IP', '203.0.113.7');
  const response = await handler(localised);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    currency: 'EUR',
    monthly: { amount: '999', formatted: '€9.99' },
    annual: { amount: '9999', formatted: '€99.99' },
  });
  assert.deepEqual(apiCalls.at(-1), {
    path: '/pricing-preview',
    body: {
      items: [
        { price_id: settings.PADDLE_PRO_MONTHLY_PRICE_ID, quantity: 1 },
        { price_id: settings.PADDLE_PRO_ANNUAL_PRICE_ID, quantity: 1 },
      ],
      customer_ip_address: '203.0.113.7',
    },
  });
  pricing = { ...pricing, details: { line_items: [] } };
  assert.equal((await handler(request('/api/billing/prices'))).status, 503);
  const calls = apiCalls.length;
  const disabled = billingHandler(db, auth, { ...settings, PADDLE_ENABLED: 'false' }, api, now);
  assert.equal((await disabled(request('/api/billing/prices'))).status, 503);
  assert.equal(apiCalls.length, calls);
});

test('portal resolves the signed-in customer only and authenticated links are never cached', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  assert.equal((await handler(request('/api/billing/portal', {}))).status, 404);
  await checkout();
  await deliver(event());
  assert.equal(
    (await handler(request('/api/billing/portal', { customerId: id('ctm', 'b') }))).status,
    400,
  );
  const response = await handler(request('/api/billing/portal', {}));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(apiCalls.at(-1)?.path, `/customers/${id('ctm')}/portal-sessions`);
});

test('hosted payment links require an owned server-created transaction and cannot confer Pro', async () => {
  await checkout();
  const handler = billingHandler(db, auth, settings, api, now);
  assert.equal(
    (await handler(request(`/api/billing?transactionId=${id('txn', 'b')}`))).status,
    403,
  );
  assert.equal((await handler(request(`/api/billing?transactionId=${id('txn')}`))).status, 200);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});

test('Paddle transport uses sandbox API, bounded responses, server authorization and generic errors', async () => {
  let called = false;
  const transport: typeof fetch = async (input, init) => {
    called = true;
    assert.equal(input, 'https://sandbox-api.paddle.com/transactions');
    assert.equal(
      (init!.headers as Record<string, string>).Authorization,
      `Bearer ${settings.PADDLE_API_KEY}`,
    );
    return Response.json({ data: { id: id('txn') } });
  };
  assert.deepEqual(await paddleApi(settings, transport)('/transactions', {}), { id: id('txn') });
  assert.ok(called);
  await assert.rejects(
    paddleApi(
      settings,
      async () => new Response('secret details', { status: 500 }),
    )('/transactions'),
    /Billing provider unavailable/,
  );
  const logged: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    await assert.rejects(
      paddleApi(settings, async () =>
        Response.json(
          { error: { code: 'transaction_default_checkout_url_not_set', detail: 'Set a URL' } },
          { status: 400 },
        ),
      )(`/customers/${id('ctm')}/portal-sessions`, {}),
      /Billing provider unavailable/,
    );
  } finally {
    console.error = log;
  }
  assert.deepEqual(logged, [
    [
      'Paddle API error',
      {
        path: '/customers/:id/portal-sessions',
        status: 400,
        code: 'transaction_default_checkout_url_not_set',
        detail: 'Set a URL',
      },
    ],
  ]);
});

test('a failed transaction call releases its reservation so checkout can be retried at once', async () => {
  const handler = billingHandler(db, auth, settings, api, now);
  providerFails = true;
  assert.equal(
    (await handler(request('/api/billing/checkout', { interval: 'monthly' }))).status,
    503,
  );
  providerFails = false;
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM billing_checkouts').first<{ n: number }>())!.n,
    0,
  );
  await checkout();
});

test('equal-time restrictive states win; a newer invalid transition cannot resurrect a canceled subscription', async () => {
  await checkout();
  const at = new Date(clock).toISOString();
  await deliver(event('subscription.activated', subscription(), at));
  await deliver(event('subscription.past_due', subscription({ status: 'past_due' }), at));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  await deliver(event('subscription.activated', subscription(), at));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
  await deliver(
    event(
      'subscription.canceled',
      subscription({ status: 'canceled', current_billing_period: null }),
      at,
    ),
  );
  await deliver(event('subscription.updated', subscription(), new Date(clock + 10).toISOString()));
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});

test('disabling new checkout preserves customer portal access and existing paid entitlements', async () => {
  await checkout();
  await deliver(event());
  const disabled = billingHandler(db, auth, { ...settings, PADDLE_ENABLED: 'false' }, api, now);
  assert.equal(
    (await disabled(request('/api/billing/checkout', { interval: 'monthly' }))).status,
    503,
  );
  assert.equal((await disabled(request('/api/billing/portal', {}))).status, 200);
  const summary = await (await disabled(request('/api/billing'))).json();
  assert.equal(summary.enabled, false);
  assert.equal(summary.canManage, true);
  assert.equal(await createD1AccessRepository(db).plan(userId), 'pro');
});

test('invalid billing periods/catalogue items and oversized or malformed webhooks never mutate access', async () => {
  await checkout();
  for (const data of [
    subscription({
      items: [
        {
          price: { id: id('pri', 'c'), billing_cycle: { interval: 'month', frequency: 1 } },
          quantity: 1,
        },
      ],
    }),
    subscription({
      current_billing_period: {
        starts_at: '2026-02-30T00:00:00Z',
        ends_at: '2026-03-31T00:00:00Z',
      },
    }),
    subscription({
      current_billing_period: {
        starts_at: new Date(clock).toISOString(),
        ends_at: new Date(clock - 1).toISOString(),
      },
    }),
    subscription({
      current_billing_period: {
        starts_at: new Date(clock).toISOString(),
        ends_at: new Date(clock + 500 * 86400_000).toISOString(),
      },
    }),
  ])
    assert.equal((await deliver(event('subscription.updated', data))).status, 422);
  const handler = paddleWebhook(db, settings, api, now);
  const malformed = '{invalid';
  assert.equal(
    (
      await handler(
        new Request(`${settings.AUTH_BASE_URL}/api/billing/webhook`, {
          method: 'POST',
          headers: { 'Paddle-Signature': await signed(malformed) },
          body: malformed,
        }),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await handler(
        new Request(`${settings.AUTH_BASE_URL}/api/billing/webhook`, {
          method: 'POST',
          body: 'x'.repeat(262145),
        }),
      )
    ).status,
    413,
  );
  assert.equal(await createD1AccessRepository(db).plan(userId), 'free');
});
