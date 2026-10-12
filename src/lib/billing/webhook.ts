import { BodyLimitError, readBoundedText } from '../http-body';
import { billingEnvironment, paddleId, type BillingSettings } from './config';
import { object, paddleApi, type PaddleRequest } from './paddle';
import { BillingRepository, type BillingDatabase } from './repository';
import { verifyPaddleSignature } from './signature';

class InvalidBillingEvent extends Error {}
const invalid = () => {
  throw new InvalidBillingEvent();
};

/** Preserve Paddle's microseconds for SQL ordering; all stored timestamps sort lexically in UTC. */
export function billingTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return invalid();
  const [whole, fraction = ''] = value.slice(0, -1).split('.');
  if (new Date(value).toISOString().slice(0, 19) !== whole) return invalid();
  return `${whole}.${fraction.padEnd(6, '0')}Z`;
}

async function owner(repo: BillingRepository, data: Record<string, unknown>, api: PaddleRequest) {
  const existing = typeof data.id === 'string' ? await repo.subscription(data.id) : null;
  if (existing) {
    if (existing.customer_id !== data.customer_id) return invalid();
    return existing.user_id;
  }
  const custom = object(data.custom_data);
  const intent = await repo.intent(custom.hibiki_checkout_id);
  if (!intent || intent.user_id !== custom.hibiki_user_id || !intent.transaction_id)
    return invalid();
  const customer = await repo.customer(intent.user_id);
  if (customer && customer.customer_id !== data.customer_id) return invalid();
  // Bind the new subscription to the transaction created by our authenticated checkout route.
  // Custom data by itself is not proof: Paddle.js callers can supply their own custom data.
  const transaction = await api(`/transactions/${intent.transaction_id}`);
  if (!transaction.subscription_id) throw new Error('Subscription transaction not ready');
  if (transaction.subscription_id !== data.id || transaction.customer_id !== data.customer_id)
    return invalid();
  return intent.user_id;
}

const states = ['active', 'trialing', 'past_due', 'paused', 'canceled'];
const eventStates: Record<string, string> = {
  'subscription.activated': 'active',
  'subscription.resumed': 'active',
  'subscription.trialing': 'trialing',
  'subscription.past_due': 'past_due',
  'subscription.paused': 'paused',
  'subscription.canceled': 'canceled',
};
const subscriptionEvents = new Set([
  'subscription.created',
  'subscription.updated',
  ...Object.keys(eventStates),
]);

export function paddleWebhook(
  db: BillingDatabase,
  settings: BillingSettings,
  api: PaddleRequest = paddleApi(settings),
  now: () => number = Date.now,
) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store' },
      });
    if (!settings.PADDLE_WEBHOOK_SECRET) return respond({ error: 'Billing unavailable' }, 503);
    try {
      const body = await readBoundedText(request, 262144);
      if (
        !(await verifyPaddleSignature(
          body,
          request.headers.get('Paddle-Signature'),
          settings.PADDLE_WEBHOOK_SECRET,
          now(),
        ))
      )
        return respond({ error: 'Invalid signature' }, 401);
      const payload = object(JSON.parse(body));
      if (!paddleId(payload.event_id, 'evt') || typeof payload.event_type !== 'string')
        return invalid();
      const event = {
        id: payload.event_id,
        type: payload.event_type,
        at: billingTimestamp(payload.occurred_at),
      };
      if (Date.parse(event.at) > now() + 60_000) return invalid();
      const repo = new BillingRepository(db, billingEnvironment(settings));
      if (await repo.seen(event.id)) return respond({ ok: true });
      const data = object(payload.data);
      if (subscriptionEvents.has(event.type)) {
        if (
          !paddleId(data.id, 'sub') ||
          !paddleId(data.customer_id, 'ctm') ||
          typeof data.status !== 'string' ||
          !states.includes(data.status) ||
          (eventStates[event.type] && eventStates[event.type] !== data.status)
        )
          return invalid();
        const items = Array.isArray(data.items) ? data.items.map(object) : [];
        const price = object(items[0]?.price);
        const cycle = object(price.billing_cycle);
        const allowed =
          price.id === settings.PADDLE_PRO_MONTHLY_PRICE_ID
            ? 'month'
            : price.id === settings.PADDLE_PRO_ANNUAL_PRICE_ID
              ? 'year'
              : null;
        if (
          items.length !== 1 ||
          items[0].quantity !== 1 ||
          !allowed ||
          cycle.interval !== allowed ||
          cycle.frequency !== 1 ||
          data.collection_mode !== 'automatic'
        )
          return invalid();
        const period = object(data.current_billing_period);
        const start = period.starts_at ? billingTimestamp(period.starts_at) : null;
        const end = period.ends_at ? billingTimestamp(period.ends_at) : null;
        if (
          (start === null) !== (end === null) ||
          (start && end && start >= end) ||
          (start && end && Date.parse(end) - Date.parse(start) > 400 * 86400_000) ||
          (start && Date.parse(start) > now() + 60_000) ||
          (['active', 'trialing', 'past_due'].includes(data.status) && !end)
        )
          return invalid();
        const change = object(data.scheduled_change);
        const cancelAt = ['cancel', 'pause'].includes(String(change.action))
          ? billingTimestamp(change.effective_at)
          : null;
        const userId = await owner(repo, data, api);
        const intent = await repo.intent(object(data.custom_data).hibiki_checkout_id);
        if (intent && intent.user_id !== userId) return invalid();
        await repo.apply(event, userId, (guard, token) => [
          db
            .prepare(
              `INSERT INTO billing_customers(user_id,environment,customer_id)
            SELECT ?,?,? WHERE ${guard} ON CONFLICT(user_id,environment) DO NOTHING`,
            )
            .bind(userId, repo.environment, data.customer_id as string, event.id, token),
          db
            .prepare(
              `INSERT INTO billing_subscriptions(environment,subscription_id,user_id,customer_id,
            price_id,status,period_start,period_end,cancel_at,last_event_at)
            SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}
            AND EXISTS(SELECT 1 FROM billing_customers WHERE user_id=? AND environment=? AND customer_id=?)
            ON CONFLICT(environment,subscription_id) DO UPDATE SET price_id=excluded.price_id,
            status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,
            cancel_at=excluded.cancel_at,last_event_at=excluded.last_event_at
            WHERE (billing_subscriptions.last_event_at < excluded.last_event_at
              OR (billing_subscriptions.last_event_at = excluded.last_event_at
                AND CASE excluded.status WHEN 'canceled' THEN 4 WHEN 'paused' THEN 3 WHEN 'past_due' THEN 2 WHEN 'trialing' THEN 1 ELSE 0 END
                  > CASE billing_subscriptions.status WHEN 'canceled' THEN 4 WHEN 'paused' THEN 3 WHEN 'past_due' THEN 2 WHEN 'trialing' THEN 1 ELSE 0 END))
            AND NOT (billing_subscriptions.status='canceled' AND excluded.status<>'canceled')
            AND billing_subscriptions.user_id=excluded.user_id AND billing_subscriptions.customer_id=excluded.customer_id`,
            )
            .bind(
              repo.environment,
              data.id as string,
              userId,
              data.customer_id as string,
              price.id as string,
              data.status as string,
              start,
              end,
              cancelAt,
              event.at,
              event.id,
              token,
              userId,
              repo.environment,
              data.customer_id as string,
            ),
        ]);
      } else if (['adjustment.created', 'adjustment.updated'].includes(event.type)) {
        if (
          !paddleId(data.id, 'adj') ||
          !paddleId(data.transaction_id, 'txn') ||
          typeof data.status !== 'string' ||
          !['approved', 'pending_approval', 'rejected', 'reversed'].includes(data.status)
        )
          return invalid();
        if (
          paddleId(data.subscription_id, 'sub') &&
          ['refund', 'chargeback'].includes(String(data.action))
        ) {
          // Fetch the transaction's actual billing period. Arrival time is not the refunded period.
          const transaction = await api(`/transactions/${data.transaction_id}`);
          if (
            transaction.id !== data.transaction_id ||
            transaction.subscription_id !== data.subscription_id ||
            transaction.customer_id !== data.customer_id
          )
            return invalid();
          const userId = await owner(repo, { ...transaction, id: data.subscription_id }, api);
          const end = billingTimestamp(object(transaction.billing_period).ends_at);
          const revoked =
            data.status === 'approved' && (data.type === 'full' || data.action === 'chargeback')
              ? 1
              : 0;
          await repo.apply(event, userId, (guard, token) => [
            db
              .prepare(
                `INSERT INTO billing_adjustments(environment,adjustment_id,subscription_id,user_id,
              transaction_id,period_end,revoked,last_event_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}
              ON CONFLICT(environment,adjustment_id) DO UPDATE SET revoked=excluded.revoked,last_event_at=excluded.last_event_at
              WHERE (billing_adjustments.last_event_at < excluded.last_event_at
                OR (billing_adjustments.last_event_at=excluded.last_event_at AND excluded.revoked>billing_adjustments.revoked))
              AND billing_adjustments.subscription_id=excluded.subscription_id
              AND billing_adjustments.transaction_id=excluded.transaction_id AND billing_adjustments.user_id=excluded.user_id`,
              )
              .bind(
                repo.environment,
                data.id as string,
                data.subscription_id as string,
                userId,
                data.transaction_id as string,
                end,
                revoked,
                event.at,
                event.id,
                token,
              ),
          ]);
        } else await repo.apply(event, null, () => []);
      } else {
        // Transactions and browser checkout completion never grant access. Subscription state owns it.
        await repo.apply(event, null, () => []);
      }
      return respond({ ok: true });
    } catch (error) {
      if (error instanceof BodyLimitError) return respond({ error: 'Payload too large' }, 413);
      if (error instanceof InvalidBillingEvent || error instanceof SyntaxError)
        return respond({ error: 'Invalid billing event' }, 422);
      // Retryable failure: no ledger entry is committed before the entitlement batch succeeds.
      console.info(JSON.stringify({ event: 'billing_webhook_unavailable' }));
      return respond({ error: 'Billing temporarily unavailable' }, 503);
    }
  };
}
