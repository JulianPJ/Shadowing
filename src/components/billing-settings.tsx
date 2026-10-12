'use client';
import { useEffect, useRef, useState } from 'react';
import {
  billingRequest,
  openCheckout,
  type BillingSummary,
  type Checkout,
} from '@/lib/billing/client';
import { refreshAccount } from '@/lib/sync/client';

export function BillingSettings({
  userId,
  verified,
  plan,
}: {
  userId: string;
  verified: boolean;
  plan: 'free' | 'pro';
}) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const acting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    async function load() {
      try {
        const transaction = new URLSearchParams(window.location.search).get('_ptxn');
        const value = await billingRequest<BillingSummary>(
          userId,
          transaction ? `?transactionId=${encodeURIComponent(transaction)}` : '',
        );
        if (!controller.signal.aborted) {
          setSummary(value);
          setCheckedAt(Date.now());
          if (value.checkout) {
            await openCheckout(value.checkout, (event) => {
              if (!controller.signal.aborted && event.name === 'checkout.completed') {
                setMessage('Payment received. Refresh your plan after confirmation.');
                void refreshAccount();
              }
            });
          }
        }
      } catch {
        if (!controller.signal.aborted)
          setMessage('Could not load billing. Try refreshing your plan.');
      }
    }
    void load();
    window.addEventListener('focus', load);
    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener('focus', load);
    };
  }, [userId]);

  async function refresh() {
    const value = await billingRequest<BillingSummary>(userId);
    await refreshAccount();
    if (mounted.current) {
      setSummary(value);
      setCheckedAt(Date.now());
    }
  }
  async function action(operation: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Billing unavailable.');
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function upgrade(interval: 'monthly' | 'annual') {
    await action(async () => {
      const checkout = await billingRequest<Checkout>(userId, '/checkout', { interval });
      if (!mounted.current) return;
      await openCheckout(checkout, (event) => {
        if (!mounted.current) return;
        if (event.name === 'checkout.completed') {
          setMessage(
            'Payment received. Your plan will update after confirmation. Refresh your plan in a moment.',
          );
          void refresh().catch(() => {
            /* Manual refresh remains available. */
          });
        } else if (event.name === 'checkout.error')
          setMessage('Checkout could not complete. Please try again.');
      });
    });
  }
  const subscription = summary?.subscriptions[0];
  const expiry = subscription?.cancelAt ?? subscription?.periodEnd;
  const expired = subscription?.status === 'active' && expiry && Date.parse(expiry) <= checkedAt;
  const existing = summary?.subscriptions.some((item) => item.status !== 'canceled');
  const date = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  return (
    <section className="billing-settings" aria-labelledby="billing-title">
      <h3 id="billing-title">Your subscription</h3>
      {summary?.environment === 'sandbox' && summary.enabled ? (
        <p className="muted">Sandbox checkout · test payments only</p>
      ) : null}
      {subscription ? (
        <p>
          {subscription.interval === 'annual' ? 'Annual' : 'Monthly'} Pro ·{' '}
          {expired ? 'expired' : subscription.status.replace('_', ' ')}
          {subscription.refunded ? ' · payment refunded' : ''}
          {subscription.cancelAt
            ? ` · ends ${date(subscription.cancelAt)}`
            : !expired &&
                subscription.status === 'active' &&
                subscription.periodEnd &&
                !subscription.refunded
              ? ` · renews ${date(subscription.periodEnd)}`
              : ''}
        </p>
      ) : plan === 'pro' ? (
        <p>Pro access has been enabled for your account.</p>
      ) : (
        <p>Choose monthly or annual Pro. The total and renewal terms appear in checkout.</p>
      )}
      {subscription?.status === 'past_due' ? (
        <p role="status">
          Your payment needs attention. Update your payment method in billing to restore Pro.
        </p>
      ) : null}
      {summary && !summary.enabled ? (
        <p className="muted">Subscriptions are awaiting setup.</p>
      ) : null}
      {!verified ? <p className="muted">Verify your email before subscribing.</p> : null}
      <div className="account-actions">
        {summary?.enabled && plan === 'free' && !existing ? (
          <>
            <button
              className="button primary"
              disabled={busy || !verified}
              onClick={() => void upgrade('monthly')}
            >
              {busy ? 'Please wait…' : 'Upgrade · Monthly'}
            </button>
            <button
              className="button primary"
              disabled={busy || !verified}
              onClick={() => void upgrade('annual')}
            >
              {busy ? 'Please wait…' : 'Upgrade · Annual'}
            </button>
          </>
        ) : null}
        {summary?.canManage ? (
          <button
            className="button"
            disabled={busy || !verified}
            onClick={() =>
              void action(async () => {
                const portal = await billingRequest<{ url: string }>(userId, '/portal', {});
                window.location.assign(portal.url);
              })
            }
          >
            Manage billing
          </button>
        ) : null}
        <button className="button" disabled={busy} onClick={() => void action(refresh)}>
          Refresh plan
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {summary?.enabled ? (
        <p className="muted">
          Payments, invoices and subscription management are handled by Paddle, our merchant of
          record.
        </p>
      ) : null}
    </section>
  );
}
