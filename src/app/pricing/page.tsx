import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { MINIMUM_ACCOUNT_AGE } from '@/lib/auth/eligibility';
import { features, publicPrices } from '@/lib/billing/features';

export const metadata: Metadata = {
  title: 'Pricing — Hibiki',
  description:
    'Hibiki is free to use. Hibiki Pro adds comprehension checks, recording, vocabulary review and progress tracking for £3.99 a month or £29.99 a year.',
};

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

export default function PricingPage() {
  return (
    <main className="notices-main">
      <h1>Pricing</h1>
      <p>
        Hibiki is a Japanese listening and speaking app built around shadowing: listen to a short
        section of real media, pause, say it back and continue. The Free plan covers watching and
        understanding. Hibiki Pro adds the tools for practising and improving.
      </p>
      <div className="pricing-plans">
        <section className="pricing-plan">
          <h2>Free</h2>
          <p className="pricing-price">
            <strong>£0</strong>
          </p>
          <p>The immersion viewer, dictionary lookup and Watch Later. No card needed.</p>
        </section>
        <section className="pricing-plan">
          <h2>Pro · Monthly</h2>
          <p className="pricing-price">
            <strong>{publicPrices.monthly}</strong> / month
          </p>
          <p>Everything in Free plus Pro features. Cancel anytime.</p>
        </section>
        <section className="pricing-plan pricing-plan-featured">
          <h2>Pro · Annual</h2>
          <p className="pricing-price">
            <strong>{publicPrices.annual}</strong> / year
          </p>
          <p>Works out at {publicPrices.annualPerMonth} a month, billed once a year.</p>
        </section>
      </div>
      <p>
        Prices are in pounds sterling. Applicable taxes are added at checkout, and the final total
        and renewal date are shown before you pay. Pro subscriptions renew automatically each month
        or year until cancelled and are for adults aged {MINIMUM_ACCOUNT_AGE} or older. Payments are
        handled securely by Paddle, our merchant of record. To subscribe,{' '}
        <Link href="/register">create an account</Link> or <Link href="/sign-in">sign in</Link>,
        then open <Link href="/profile">your profile</Link>.
      </p>
      <h2>What is in each plan</h2>
      <table className="pricing-features">
        <caption className="sr-only">Hibiki Free and Hibiki Pro features</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Free</th>
            <th scope="col">Pro</th>
          </tr>
        </thead>
        <tbody>
          {features.map(([name, detail, free]) => (
            <tr key={name}>
              <th scope="row">
                {name}
                <span>{detail}</span>
              </th>
              <td>
                <Included value={free} />
              </td>
              <td>
                <Included value />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Cancelling and refunds</h2>
      <p>
        You can cancel at any time from <Link href="/account">Account</Link>; Pro then stays active
        until the end of the period you have paid for. Payments are non-refundable, including for
        unused time or partial periods, except where the law requires a refund. Your statutory
        rights are not affected. See{' '}
        <Link href="/refunds">subscriptions, cancellations and refunds</Link>, our{' '}
        <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Questions?{' '}
        <Link href="/contact">Contact Hibiki</Link>.
      </p>
    </main>
  );
}
