'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  billingRequest,
  openCheckout,
  type BillingInterval,
  type BillingSummary,
  type Checkout,
} from '@/lib/billing/client';
import { refreshAccount } from '@/lib/sync/client';
import type { PaddleEventData } from '@paddle/paddle-js';
import { SubscriptionDialog } from './subscription-dialog';

// Paddle's webhook usually lands within seconds; back off so a slow one stays under the rate limit.
const CONFIRM_DELAYS = [2000, 4000, 6000, 10000, 15000, 25000, 40000];

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
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const acting = useRef(false);
  const confirming = useRef<number | undefined>(undefined);
  const autoOpened = useRef(false);

  async function refresh() {
    const value = await billingRequest<BillingSummary>(userId);
    await refreshAccount();
    if (mounted.current) {
      setSummary(value);
      setCheckedAt(Date.now());
    }
    return value;
  }
  /** Polls until the subscription webhook commits; Pro then moves this section into Account. */
  function confirmPayment(attempt = 0) {
    if (!mounted.current) return;
    if (attempt >= CONFIRM_DELAYS.length) {
      setMessage(
        'Payment received. Paddle is still confirming it. Pro will appear here within a few minutes.',
      );
      return;
    }
    confirming.current = window.setTimeout(async () => {
      const value = await refresh().catch(() => null);
      if (!value?.subscriptions.some((item) => item.status === 'active'))
        confirmPayment(attempt + 1);
    }, CONFIRM_DELAYS[attempt]);
  }
  function checkoutEvent(event: PaddleEventData) {
    if (!mounted.current) return;
    if (event.name === 'checkout.completed') {
      setMessage('Payment received. Activating Hibiki Pro…');
      window.clearTimeout(confirming.current);
      confirmPayment();
    } else if (event.name === 'checkout.error')
      setMessage('Checkout could not complete. Please try again.');
  }

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
          setFailed(false);
          setSummary(value);
          setCheckedAt(Date.now());
          if (value.checkout) await openCheckout(value.checkout, checkoutEvent);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage('Could not load billing. Please refresh the page.');
        }
      }
    }
    void load();
    window.addEventListener('focus', load);
    return () => {
      mounted.current = false;
      controller.abort();
      window.clearTimeout(confirming.current);
      window.removeEventListener('focus', load);
    };
    // checkoutEvent only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
  async function upgrade(interval: BillingInterval) {
    await action(async () => {
      const checkout = await billingRequest<Checkout>(userId, '/checkout', { interval });
      if (!mounted.current) return;
      // A modal dialog sits in the top layer, above Paddle's overlay.
      setOpen(false);
      await openCheckout(checkout, checkoutEvent);
    });
  }

  const subscription = summary?.subscriptions[0];
  const expiry = subscription?.cancelAt ?? subscription?.periodEnd;
  const expired = subscription?.status === 'active' && expiry && Date.parse(expiry) <= checkedAt;
  const existing = summary?.subscriptions.some((item) => item.status !== 'canceled');
  const offer = plan === 'free' && !existing;
  const blocked = !summary
    ? failed
      ? ''
      : 'Checking subscription availability…'
    : !summary.enabled
      ? 'Subscriptions are awaiting setup.'
      : !verified
        ? 'Verify your email before subscribing.'
        : '';
  // "Compare Free and Pro" links land on #plans and go straight to the options.
  useEffect(() => {
    if (!summary || autoOpened.current || !offer || window.location.hash !== '#plans') return;
    autoOpened.current = true;
    setOpen(true);
  }, [summary, offer]);
  const date = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  return (
    <section
      className={`billing-settings${offer ? ' billing-offer' : ''}`}
      id={plan === 'free' ? 'plans' : undefined}
      aria-labelledby="billing-title"
    >
      {offer ? (
        <>
          <div className="billing-offer-copy">
            <span className="billing-offer-eyebrow">
              <Sparkles size={13} /> Hibiki Pro
            </span>
            <h2 id="billing-title">Your subscription</h2>
            <p>
              You’re on Hibiki Free. Upgrade for comprehension checks, essential vocabulary,
              auto-generated subtitles and Shadowing Match.
            </p>
          </div>
          <button className="button primary billing-offer-button" onClick={() => setOpen(true)}>
            View subscription options <ArrowRight size={16} />
          </button>
          {summary && !summary.enabled ? (
            <p className="billing-offer-note">Subscriptions are awaiting setup.</p>
          ) : null}
        </>
      ) : (
        <>
          <h3 id="billing-title">Your subscription</h3>
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
          ) : (
            <p>Pro access has been enabled for your account.</p>
          )}
          {subscription?.status === 'past_due' ? (
            <p role="status">
              Your payment needs attention. Update your payment method in billing to restore Pro.
            </p>
          ) : null}
          {summary?.canManage ? (
            <div className="account-actions">
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
            </div>
          ) : null}
          {summary?.enabled ? (
            <p className="muted">
              Payments, invoices and subscription management are handled by Paddle, our merchant of
              record.
            </p>
          ) : null}
        </>
      )}
      {message && !open ? <p role="status">{message}</p> : null}
      {offer ? (
        <SubscriptionDialog
          open={open}
          onClose={() => setOpen(false)}
          userId={userId}
          priced={!!summary?.enabled}
          blocked={blocked}
          canCheckout={!!summary?.enabled && verified}
          sandbox={summary?.environment === 'sandbox'}
          busy={busy}
          message={open ? message : ''}
          onChoose={(interval) => void upgrade(interval)}
        />
      ) : null}
    </section>
  );
}
