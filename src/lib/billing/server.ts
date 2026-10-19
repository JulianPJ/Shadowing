import type { HibikiAuth } from '../auth/server';
import { hasAdultSelfDeclaration, MINIMUM_ACCOUNT_AGE } from '../auth/eligibility';
import { BodyLimitError, readBoundedText } from '../http-body';
import { billingConfigured, billingEnvironment, paddleId, type BillingSettings } from './config';
import { object, paddleApi, type PaddleRequest } from './paddle';
import { BillingRepository, type BillingDatabase } from './repository';

type BillingAuth = Pick<HibikiAuth, 'api'>;
export function billingHandler(
  db: BillingDatabase,
  auth: BillingAuth,
  settings: BillingSettings,
  api: PaddleRequest = paddleApi(settings),
  now: () => number = Date.now,
) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' },
      });
    try {
      const url = new URL(request.url);
      if (
        !settings.AUTH_BASE_URL ||
        url.origin !== new URL(settings.AUTH_BASE_URL).origin ||
        (request.method === 'POST' &&
          (request.headers.get('origin') !== url.origin ||
            request.headers.get('content-type')?.split(';')[0] !== 'application/json'))
      )
        return respond({ error: 'Invalid origin or content type' }, 403);
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return respond({ error: 'Sign in to manage your subscription.' }, 401);
      const userId = session.user.id;
      const adult = hasAdultSelfDeclaration(session.user);
      const adultRequired = () =>
        respond(
          {
            code: 'adult-confirmation-required',
            error: `Subscriptions are only available to adults aged ${MINIMUM_ACCOUNT_AGE} or older.`,
          },
          403,
        );
      if (request.headers.get('X-Hibiki-Account') !== userId)
        return respond({ error: 'Account changed. Refresh your session.' }, 409);
      const repo = new BillingRepository(db, billingEnvironment(settings));
      if (request.method === 'GET' && url.pathname === '/api/billing') {
        const subscriptions = await repo.subscriptions(userId);
        const transactionId = url.searchParams.get('transactionId');
        if (transactionId && !adult) return adultRequired();
        if (
          transactionId &&
          (!session.user.emailVerified ||
            !billingConfigured(settings) ||
            !paddleId(transactionId, 'txn') ||
            !(await repo.ownsTransaction(userId, transactionId)))
        )
          return respond({ error: 'Checkout does not belong to this account.' }, 403);
        return respond({
          enabled: billingConfigured(settings),
          environment: repo.environment,
          subscriptions: subscriptions.map(
            ({ subscription_id, status, price_id, period_end, cancel_at, refunded }) => ({
              id: subscription_id,
              status,
              interval: price_id === settings.PADDLE_PRO_ANNUAL_PRICE_ID ? 'annual' : 'monthly',
              periodEnd: period_end,
              cancelAt: cancel_at,
              refunded: !!refunded,
            }),
          ),
          canManage: !!settings.PADDLE_API_KEY && !!(await repo.customer(userId)),
          ...(transactionId
            ? {
                checkout: {
                  transactionId,
                  clientToken: settings.PADDLE_CLIENT_TOKEN,
                  environment: repo.environment,
                },
              }
            : {}),
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/billing/prices') {
        if (!billingConfigured(settings))
          return respond({ error: 'Subscriptions are awaiting setup.' }, 503);
        // Paddle localises currency and estimates tax from the learner's IP, as checkout will.
        const ip = request.headers.get('CF-Connecting-IP');
        const preview = await api('/pricing-preview', {
          items: [
            { price_id: settings.PADDLE_PRO_MONTHLY_PRICE_ID, quantity: 1 },
            { price_id: settings.PADDLE_PRO_ANNUAL_PRICE_ID, quantity: 1 },
          ],
          ...(ip ? { customer_ip_address: ip } : {}),
        });
        const items = object(preview.details).line_items;
        const price = (id: string | undefined) => {
          const item = object(
            (Array.isArray(items) ? items : []).find(
              (value) => object(object(value).price).id === id,
            ),
          );
          const amount = object(item.totals).total;
          const formatted = object(item.formatted_totals).total;
          if (typeof amount !== 'string' || !/^\d+$/.test(amount) || typeof formatted !== 'string')
            throw new Error('Invalid pricing response');
          return { amount, formatted };
        };
        const currency = preview.currency_code;
        if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
          throw new Error('Invalid pricing response');
        return respond({
          currency,
          monthly: price(settings.PADDLE_PRO_MONTHLY_PRICE_ID),
          annual: price(settings.PADDLE_PRO_ANNUAL_PRICE_ID),
        });
      }
      if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
      if (!session.user.emailVerified)
        return respond({ error: 'Verify your email before subscribing.' }, 403);
      const body = object(JSON.parse(await readBoundedText(request, 1024)));
      if (url.pathname === '/api/billing/checkout') {
        if (!adult) return adultRequired();
        if (!billingConfigured(settings))
          return respond({ error: 'Subscriptions are awaiting setup.' }, 503);
        if (
          (body.interval !== 'monthly' && body.interval !== 'annual') ||
          Object.keys(body).some((key) => key !== 'interval')
        )
          return respond({ error: 'Choose a monthly or annual subscription.' }, 400);
        const subscriptions = await repo.subscriptions(userId);
        if (subscriptions.some((s) => s.status !== 'canceled'))
          return respond({ error: 'Manage your existing subscription through billing.' }, 409);
        const price =
          body.interval === 'annual'
            ? settings.PADDLE_PRO_ANNUAL_PRICE_ID!
            : settings.PADDLE_PRO_MONTHLY_PRICE_ID!;
        let pending = await repo.pending(userId, now());
        // Switching interval retires the ready checkout. Its transaction stays owned, so a payment
        // completed on it still links through its intent.
        if (pending?.transaction_id && pending.price_id !== price) {
          await repo.retire(userId, pending.transaction_id, now());
          pending = null;
        }
        if (pending && !pending.transaction_id)
          return respond({ error: 'A checkout is already being prepared. Try again later.' }, 409);
        let transactionId = pending?.transaction_id;
        if (!transactionId) {
          const intent = await repo.createIntent(userId, price, now());
          if (!intent) return respond({ error: 'A checkout is already being prepared.' }, 409);
          try {
            const customer = await repo.customer(userId);
            const transaction = await api('/transactions', {
              items: [{ price_id: price, quantity: 1 }],
              collection_mode: 'automatic',
              ...(customer ? { customer_id: customer.customer_id } : {}),
              custom_data: { hibiki_user_id: userId, hibiki_checkout_id: intent.id },
              checkout: { url: `${url.origin}/profile` },
            });
            if (!paddleId(transaction.id, 'txn')) throw new Error('Invalid checkout response');
            transactionId = transaction.id;
            await repo.attachTransaction(intent.id, transactionId);
          } catch (error) {
            // An unlinked transaction can never be opened, so the learner may retry at once.
            await repo.release(intent.id).catch(() => {});
            throw error;
          }
        }
        return respond({
          transactionId,
          clientToken: settings.PADDLE_CLIENT_TOKEN,
          environment: repo.environment,
        });
      }
      if (url.pathname === '/api/billing/portal') {
        if (!settings.PADDLE_API_KEY) return respond({ error: 'Billing is awaiting setup.' }, 503);
        if (Object.keys(body).length) return respond({ error: 'Invalid portal request' }, 400);
        const customer = await repo.customer(userId);
        if (!customer) return respond({ error: 'No subscription to manage yet.' }, 404);
        const portal = await api(`/customers/${customer.customer_id}/portal-sessions`, {});
        const link = object(object(portal.urls).general).overview;
        if (typeof link !== 'string') throw new Error('Invalid portal response');
        const portalUrl = new URL(link);
        const host =
          repo.environment === 'sandbox'
            ? 'sandbox-customer-portal.paddle.com'
            : 'customer-portal.paddle.com';
        if (
          portalUrl.protocol !== 'https:' ||
          portalUrl.hostname !== host ||
          portalUrl.username ||
          portalUrl.password
        )
          throw new Error('Invalid portal response');
        return respond({ url: link });
      }
      return respond({ error: 'Route not supported' }, 404);
    } catch (error) {
      if (error instanceof BodyLimitError) return respond({ error: 'Request too large' }, 413);
      if (error instanceof SyntaxError) return respond({ error: 'Invalid request' }, 400);
      return respond({ error: 'Billing temporarily unavailable. Please try again.' }, 503);
    }
  };
}
