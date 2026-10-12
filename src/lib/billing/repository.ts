import type { BillingEnvironment } from './config';

export interface BillingStatement {
  bind(...values: (string | number | null)[]): BillingStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface BillingDatabase {
  prepare(sql: string): BillingStatement;
  batch(statements: BillingStatement[]): Promise<unknown[]>;
}
export type Subscription = {
  subscription_id: string;
  user_id: string;
  customer_id: string;
  price_id: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  cancel_at: string | null;
};

export class BillingRepository {
  constructor(
    readonly db: BillingDatabase,
    readonly environment: BillingEnvironment,
  ) {}

  async customer(userId: string) {
    return this.db
      .prepare('SELECT customer_id FROM billing_customers WHERE user_id=? AND environment=?')
      .bind(userId, this.environment)
      .first<{ customer_id: string }>();
  }

  async subscription(id: string) {
    return this.db
      .prepare('SELECT * FROM billing_subscriptions WHERE environment=? AND subscription_id=?')
      .bind(this.environment, id)
      .first<Subscription>();
  }

  async subscriptions(userId: string) {
    return (
      await this.db
        .prepare(
          `SELECT *, EXISTS(SELECT 1 FROM billing_adjustments a
      WHERE a.environment=s.environment AND a.subscription_id=s.subscription_id
      AND a.revoked=1 AND a.period_end >= s.period_end) AS refunded
      FROM billing_subscriptions s WHERE s.user_id=? AND s.environment=? ORDER BY s.last_event_at DESC`,
        )
        .bind(userId, this.environment)
        .all<Subscription & { refunded: number }>()
    ).results;
  }

  async intent(id: unknown) {
    if (typeof id !== 'string') return null;
    return this.db
      .prepare('SELECT * FROM billing_checkouts WHERE id=? AND environment=?')
      .bind(id, this.environment)
      .first<{
        id: string;
        user_id: string;
        price_id: string;
        transaction_id: string | null;
      }>();
  }

  async createIntent(userId: string, priceId: string, now: number) {
    const id = crypto.randomUUID();
    // Atomic reservation blocks concurrent checkout clicks; a failed provider call releases it.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO billing_checkouts
      (id,user_id,environment,price_id,created_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM billing_checkouts
      WHERE user_id=? AND environment=? AND expires_at>?)`,
        )
        .bind(
          id,
          userId,
          this.environment,
          priceId,
          new Date(now).toISOString(),
          new Date(now + 30 * 60_000).toISOString(),
          userId,
          this.environment,
          new Date(now).toISOString(),
        ),
    ]);
    return await this.intent(id);
  }

  async release(id: string) {
    await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM billing_checkouts WHERE id=? AND environment=? AND transaction_id IS NULL',
        )
        .bind(id, this.environment),
    ]);
  }

  async attachTransaction(id: string, transactionId: string) {
    await this.db.batch([
      this.db
        .prepare('UPDATE billing_checkouts SET transaction_id=? WHERE id=? AND environment=?')
        .bind(transactionId, id, this.environment),
    ]);
  }

  async retire(userId: string, transactionId: string, now: number) {
    await this.db.batch([
      this.db
        .prepare(
          'UPDATE billing_checkouts SET expires_at=? WHERE user_id=? AND environment=? AND transaction_id=?',
        )
        .bind(new Date(now).toISOString(), userId, this.environment, transactionId),
    ]);
  }

  async pending(userId: string, now: number) {
    return this.db
      .prepare(
        `SELECT transaction_id,price_id FROM billing_checkouts
      WHERE user_id=? AND environment=? AND expires_at>? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(userId, this.environment, new Date(now).toISOString())
      .first<{ transaction_id: string | null; price_id: string }>();
  }

  async ownsTransaction(userId: string, transactionId: string) {
    return !!(await this.db
      .prepare(
        'SELECT 1 FROM billing_checkouts WHERE user_id=? AND environment=? AND transaction_id=?',
      )
      .bind(userId, this.environment, transactionId)
      .first());
  }

  async seen(eventId: string) {
    return !!(await this.db
      .prepare('SELECT 1 FROM billing_events WHERE environment=? AND event_id=?')
      .bind(this.environment, eventId)
      .first());
  }

  /** Materialize only the paid expiry. Existing manual/test fields are never overwritten. */
  projection(userId: string): BillingStatement {
    const column = this.environment === 'sandbox' ? 'paddle_sandbox_until' : 'paddle_live_until';
    return this.db
      .prepare(
        `INSERT INTO user_access(user_id,plan,source,updated_at,${column})
      VALUES (?,'free','paddle',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      (SELECT MAX(CASE WHEN cancel_at IS NOT NULL AND cancel_at < period_end THEN cancel_at ELSE period_end END)
      FROM billing_subscriptions s WHERE user_id=? AND environment=? AND status='active'
      AND NOT EXISTS(SELECT 1 FROM billing_adjustments a WHERE a.environment=s.environment
      AND a.subscription_id=s.subscription_id AND a.revoked=1 AND a.period_end>=s.period_end)))
      ON CONFLICT(user_id) DO UPDATE SET ${column}=excluded.${column}`,
      )
      .bind(userId, userId, this.environment);
  }

  async apply(
    event: { id: string; type: string; at: string },
    userId: string | null,
    statements: (guard: string, token: string) => BillingStatement[],
  ) {
    const token = crypto.randomUUID();
    const guard = `EXISTS(SELECT 1 FROM billing_events WHERE environment='${this.environment}'
      AND event_id=? AND processing_token=?)`;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO billing_events
        (environment,event_id,event_type,occurred_at,processing_token,received_at) VALUES (?,?,?,?,?,?)`,
        )
        .bind(this.environment, event.id, event.type, event.at, token, new Date().toISOString()),
      ...statements(guard, token),
      ...(userId ? [this.projection(userId)] : []),
    ]);
  }
}
