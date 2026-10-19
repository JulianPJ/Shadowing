import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal-shell';
import { LEGAL_OPERATOR } from '@/lib/legal/operator';

export const metadata: Metadata = { title: 'Contact & Business Details — Hibiki' };

export default function ContactPage() {
  return (
    <LegalShell title="Contact & business details">
      <p>
        Use these details to contact the operator of Hibiki regarding the
        learning service, legal matters and personal information.
      </p>
      <section>
        <h2>Service operator</h2>
        <dl>
          <dt>Legal or trading name</dt>
          <dd>{LEGAL_OPERATOR.name}</dd>
          <dt>Country of establishment</dt>
          <dd>{LEGAL_OPERATOR.establishedIn}</dd>
          <dt>Geographic business address</dt>
          <dd>{LEGAL_OPERATOR.address}</dd>
          <dt>Company or business registration</dt>
          <dd>{LEGAL_OPERATOR.registration}</dd>
          <dt>VAT registration</dt>
          <dd>{LEGAL_OPERATOR.vat}</dd>
          <dt>Service support email</dt>
          <dd>{LEGAL_OPERATOR.email}</dd>
          <dt>Privacy and data requests</dt>
          <dd>{LEGAL_OPERATOR.privacyEmail}</dd>
        </dl>
      </section>
      <section>
        <h2>Product support</h2>
        <p>
          For general bug reports that contain no private information you can use
          the <a href="https://github.com/JulianPJ/Shadowing/issues">Hibiki issue tracker</a>.
          GitHub issues are public: <strong>do not post account details, email addresses,
          passwords, payment information, private media or sensitive learning records</strong>.
          Send private support and data-protection requests to the relevant email above.
        </p>
      </section>
      <section>
        <h2>Payment support</h2>
        <p>
          Paddle is the seller and merchant of record for Pro subscriptions. For
          receipts, billing questions, cancellations and refund requests, use{' '}
          <a href="https://paddle.net/">Paddle Buyer Support</a>. Our{' '}
          <Link href="/refunds">Subscription & Refund Policy</Link> explains
          how to find the customer portal.
        </p>
      </section>
    </LegalShell>
  );
}
