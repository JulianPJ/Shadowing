'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Sparkles, X } from 'lucide-react';
import { MINIMUM_ACCOUNT_AGE } from '@/lib/auth/eligibility';
import { billingRequest, type BillingInterval, type BillingPrices } from '@/lib/billing/client';

const features: [name: string, detail: string, free: boolean][] = [
  ['Comprehension checks', 'Questions on every lesson, with the evidence replayed', false],
  ['Essential vocabulary', 'The topic words that matter most, with meanings', false],
  ['Auto-generated subtitles', 'Accurate subtitles for media without captions', false],
  ['Shadowing Match', 'See how closely your recording follows the speaker', false],
  ['Immersion viewer', 'Discover, imports, captions, transcripts and manual replay', true],
  ['Dictionary lookup', 'Definitions, readings and furigana', true],
  ['Watch Later sync', 'Your watch list and basic viewer preferences across devices', true],
  [
    'Sentence translations',
    'On-demand translations; subtitle-supplied translations stay Free',
    false,
  ],
  ['Detailed difficulty', 'Lesson language demands and breakdowns', false],
  [
    'Recording and advanced drills',
    'Recorded attempts, local diagnostics and hands-free practice',
    false,
  ],
  ['Saved words and sentences', 'Word statuses, vocabulary management and Anki/CSV export', false],
  ['Daily word review', 'Spaced review of the words you save', false],
  [
    'Progress and learning sync',
    'Detailed analytics, weekly reports, daily goals and learning data across devices',
    false,
  ],
];

/** Savings and per-month figures derived from Paddle's minor-unit totals. */
function priceDetails(prices: BillingPrices) {
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: prices.currency });
  const unit = 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
  const yearAtMonthly = Number(prices.monthly.amount) * 12;
  const annual = Number(prices.annual.amount);
  const saving = yearAtMonthly > 0 ? Math.round((1 - annual / yearAtMonthly) * 100) : 0;
  return {
    saving: saving >= 1 ? saving : 0,
    perMonth: format.format(annual / 12 / unit),
    yearAtMonthly: format.format(yearAtMonthly / unit),
  };
}

function Included({ value }: { value: boolean }) {
  return value ? (
    <span className="subscription-yes" role="img" aria-label="Included">
      <Check size={14} strokeWidth={3} />
    </span>
  ) : (
    <span className="subscription-no" role="img" aria-label="Not included">
      <Minus size={14} strokeWidth={3} />
    </span>
  );
}

export function SubscriptionDialog({
  open,
  onClose,
  userId,
  priced,
  blocked,
  canCheckout,
  sandbox,
  busy,
  message,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Billing is configured, so Paddle can preview prices. */
  priced: boolean;
  /** Why checkout cannot open yet, shown above the button. */
  blocked: string;
  canCheckout: boolean;
  sandbox: boolean;
  busy: boolean;
  message: string;
  onChoose: (interval: BillingInterval) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<BillingInterval>('annual');
  const [prices, setPrices] = useState<BillingPrices | 'error' | null>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open || !priced || prices) return;
    let active = true;
    billingRequest<BillingPrices>(userId, '/prices')
      .then((value) => active && setPrices(value))
      .catch(() => active && setPrices('error'));
    return () => {
      active = false;
    };
  }, [open, priced, prices, userId]);

  const loaded = prices && prices !== 'error' ? prices : null;
  const details = loaded ? priceDetails(loaded) : null;
  const plans = [
    {
      id: 'annual' as const,
      name: 'Annual',
      price: loaded?.annual.formatted,
      per: 'year',
      note: details ? `Just ${details.perMonth} a month, billed yearly` : 'Billed once a year',
      was: details?.saving ? details.yearAtMonthly : null,
    },
    {
      id: 'monthly' as const,
      name: 'Monthly',
      price: loaded?.monthly.formatted,
      per: 'month',
      note: 'Flexible. Cancel anytime',
      was: null,
    },
  ];
  const chosen = plans.find((plan) => plan.id === choice)!;

  return (
    <dialog
      ref={ref}
      className="subscription-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="subscription-title"
    >
      <button
        className="icon-button subscription-close"
        aria-label="Close subscription options"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="subscription-scroll">
        <header className="subscription-hero">
          <span className="subscription-mark" aria-hidden="true">
            響
          </span>
          <span className="subscription-eyebrow">
            <Sparkles size={13} /> Hibiki Pro
          </span>
          <h2 id="subscription-title">Hear more. Understand more.</h2>
          <p>Everything in Free, plus the tools that turn listening into understanding.</p>
        </header>
        <fieldset className="subscription-plans">
          <legend className="sr-only">Billing period</legend>
          {plans.map((plan) => (
            <label
              key={plan.id}
              className={`subscription-plan${choice === plan.id ? ' selected' : ''}`}
            >
              <input
                className="subscription-plan-input"
                type="radio"
                name="subscription-interval"
                value={plan.id}
                checked={choice === plan.id}
                onChange={() => setChoice(plan.id)}
              />
              {plan.id === 'annual' ? (
                <span className="subscription-ribbon">Best value</span>
              ) : null}
              <span className="subscription-plan-head">
                <span className="subscription-plan-name">{plan.name}</span>
                {plan.id === 'annual' && details?.saving ? (
                  <span className="subscription-save">Save {details.saving}%</span>
                ) : null}
                <span className="subscription-radio" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
                </span>
              </span>
              <span className="subscription-price">
                {plan.price ? (
                  <>
                    <strong>{plan.price}</strong>
                    <span> / {plan.per}</span>
                  </>
                ) : (
                  <span className={prices === null && priced ? 'subscription-price-loading' : ''}>
                    {prices === null && priced ? 'Loading price…' : 'Price shown at checkout'}
                  </span>
                )}
                {plan.was ? <s aria-label={`Was ${plan.was}`}>{plan.was}</s> : null}
              </span>
              <span className="subscription-plan-note">{plan.note}</span>
            </label>
          ))}
        </fieldset>
        <table className="subscription-features">
          <caption className="sr-only">Hibiki Free and Hibiki Pro features</caption>
          <thead>
            <tr>
              <th scope="col">What you get</th>
              <th scope="col">Free</th>
              <th scope="col" className="subscription-pro-column">
                Pro
              </th>
            </tr>
          </thead>
          <tbody>
            {features.map(([name, detail, free]) => (
              <tr key={name} className={free ? '' : 'subscription-pro-row'}>
                <th scope="row">
                  {name}
                  <span>{detail}</span>
                </th>
                <td>
                  <Included value={free} />
                </td>
                <td className="subscription-pro-column">
                  <Included value />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="subscription-footer">
        {blocked ? <p className="subscription-notice">{blocked}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button
          className="button primary subscription-cta"
          disabled={busy || !canCheckout}
          onClick={() => onChoose(choice)}
        >
          {busy
            ? 'Opening secure checkout…'
            : `Continue with ${chosen.name}${chosen.price ? ` · ${chosen.price} / ${chosen.per}` : ''}`}
        </button>
        <p className="subscription-fine">
          {sandbox ? 'Sandbox · test payments only · ' : ''}Secure checkout by Paddle · Cancel
          anytime · Final price confirmed at checkout
        </p>
        <p className="subscription-fine">
          For adults aged {MINIMUM_ACCOUNT_AGE} or older. Renewing subscription. Cancels at the end
          of your paid billing period. See our <Link href="/terms">Terms</Link>,{' '}
          <Link href="/refunds">cancellation and refund information</Link> and{' '}
          <Link href="/privacy">Privacy Policy</Link>. Paddle&apos;s{' '}
          <a href="https://www.paddle.com/legal/buyer-terms">Buyer Terms</a> also apply.
        </p>
      </footer>
    </dialog>
  );
}
