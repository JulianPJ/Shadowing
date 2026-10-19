import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'Subscriptions & Refunds — Hibiki' };

export default function RefundsPage() {
  return (
    <LegalShell title="Subscriptions, cancellations and refunds">
      <p>
        Hibiki Free does not require a subscription. Hibiki Pro is offered as a recurring
        monthly or annual subscription through Paddle, which acts as merchant of record and
        seller of the purchase. Hibiki supplies the learning software; Paddle handles
        payment collection, applicable taxes, receipts, refunds and payment support.
      </p>
      <section>
        <h2>Prices, renewal and confirmation</h2>
        <p>
          The exact subscription price, currency, taxes, billing interval and renewal
          conditions appear before you confirm payment in Paddle's secure checkout.
          Monthly subscriptions renew monthly and annual subscriptions renew annually
          unless cancelled. Prices shown by Hibiki are previews; the final amount
          presented at checkout takes precedence. There is currently no automatic
          free trial in the standard plan configuration.
        </p>
      </section>
      <section>
        <h2>How to cancel</h2>
        <p>
          Sign in to Hibiki, open <Link href="/account">Account</Link>, select
          <strong> Manage billing</strong> and follow the Paddle customer portal
          instructions. You can also use the subscription link in your Paddle
          confirmation email or contact <a href="https://paddle.net/">Paddle Buyer Support</a>.
          For a normal end-of-period cancellation, Paddle's current buyer terms
          provide that the subscription ends at the end of the paid billing period
          and no further renewal payments are taken. Cancellation does not
          automatically refund the current billing period.
        </p>
        <p>
          Closing your Hibiki account or uninstalling Hibiki Bridge does not by itself
          cancel a Paddle subscription. Cancel billing before closing your account.
        </p>
      </section>
      <section>
        <h2>Refunds, withdrawals and consumer rights</h2>
        <p>
          Refund eligibility depends on Paddle's{' '}
          <a href="https://www.paddle.com/legal/refund-policy">Refund Policy</a>,
          its <a href="https://www.paddle.com/legal/buyer-terms">Buyer Terms</a>,
          and any applicable mandatory consumer rights. Some consumers may have
          statutory cooling-off or withdrawal rights, including rights for digital
          services. The conditions depend on the purchase, whether provision has
          started and any legally required express consent and acknowledgements.
          We do not assert that opening or using Hibiki automatically removes those
          rights. Neither these pages nor Paddle's standard terms override
          non-excludable statutory rights.
        </p>
        <p>
          For a refund or to exercise a statutory withdrawal right, visit{' '}
          <a href="https://paddle.net/">paddle.net</a> and select the relevant
          purchase. You can also use the support link in your Paddle receipt.
          Hibiki can help with problems accessing the software, but cannot issue a
          card refund independently of Paddle.
        </p>
      </section>
      <section>
        <h2>Failed payments and loss of access</h2>
        <p>
          An overdue, cancelled, expired or fully refunded subscription may
          suspend or end access to Pro features in accordance with the current
          paid period and applicable law. Previously saved learning data is
          not deleted solely because a subscription ends. Access can be restored
          following successful renewal or a new Pro subscription.
        </p>
      </section>
      <section>
        <h2>Sandbox payments</h2>
        <p>
          If a checkout is clearly labelled as a Paddle sandbox or test checkout,
          it does not collect real money and does not create a live paid subscription.
        </p>
      </section>
      <section>
        <h2>Need assistance?</h2>
        <p>
          For payments, receipts and refund requests, use{' '}
          <a href="https://paddle.net/">Paddle Buyer Support</a>. For a Hibiki
          feature or access problem, visit our <Link href="/contact">Contact page</Link>.
        </p>
      </section>
    </LegalShell>
  );
}
