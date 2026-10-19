import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal-shell';
import { LEGAL_OPERATOR } from '@/lib/legal/operator';

export const metadata: Metadata = { title: 'Terms of Service — Hibiki' };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These terms apply to your use of Hibiki at <a href="https://hibikiapp.net">hibikiapp.net</a>{' '}
        and its companion browser extension, Hibiki Bridge. The service is operated by{' '}
        <strong>{LEGAL_OPERATOR.name}</strong>, a sole trader trading as {LEGAL_OPERATOR.tradingName}, established in {LEGAL_OPERATOR.establishedIn}, with
        business address {LEGAL_OPERATOR.address}. The operator&apos;s contact details are on our{' '}
        <Link href="/contact">Contact page</Link>.
      </p>
      <section>
        <h2>1. What Hibiki provides</h2>
        <p>
          Hibiki offers a Japanese-language immersion player, interactive captions and dictionary
          lookup, and optional Pro practice features such as recording, vocabulary review, generated
          subtitles and study feedback. Features depend on account status, source availability,
          browser compatibility and the subscription selected. We do not guarantee the availability
          of any particular video or provider caption track.
        </p>
      </section>
      <section>
        <h2>2. Accounts and acceptable use</h2>
        <p>
          Some functions can be used without an account. For an account, provide accurate details,
          protect your credentials and do not share access or misuse another person&apos;s account.
          Do not attempt to bypass Pro access controls, inference limits or security controls,
          disrupt the service, use it unlawfully or submit material you have no right to use.
          Contact us promptly if you suspect unauthorised account access.
        </p>
        <p>
          If you are not legally able to agree to these terms yourself, obtain any consent that is
          required from your parent or guardian before registering or subscribing.
        </p>
      </section>
      <section>
        <h2>3. Videos, subtitles and your content</h2>
        <p>
          Video content stays with its original provider or on your device, as applicable.
          Third-party websites and media may have separate terms and restrictions. You are
          responsible for ensuring you can lawfully view, upload or provide the media, captions and
          text that you choose to process. You retain any rights you have in your own content and
          permit Hibiki to process the parts you deliberately provide to deliver the feature
          requested. Hibiki does not grant permission to download, copy or redistribute third-party
          works. The browser extension cannot guarantee access to protected media or captions.
        </p>
      </section>
      <section>
        <h2>4. AI-generated and educational output</h2>
        <p>
          Transcriptions, translations, language-level estimates, quizzes and speaking feedback may
          be incomplete or inaccurate. Use them as study aids rather than authoritative assessments
          of pronunciation or fluency. AI processing is performed only for relevant requested
          features, and may be subject to fair-use or technical limits disclosed in the product.
        </p>
      </section>
      <section>
        <h2>5. Free and Pro; payment contracts</h2>
        <p>
          Free and Pro capabilities are described in Hibiki&apos;s subscription comparison. For paid
          subscriptions, Paddle acts as merchant of record and seller for the purchase: checkout,
          tax calculation, payment collection, invoices and payment-related customer support are
          handled by Paddle. Paddle&apos;s{' '}
          <a href="https://www.paddle.com/legal/buyer-terms">Buyer Terms</a> apply to those
          transactions alongside applicable consumer law. Hibiki continues to provide the software
          and support the learning service. See our{' '}
          <Link href="/refunds">Subscriptions, cancellations and refunds</Link> notice.
        </p>
      </section>
      <section>
        <h2>6. Availability and account closure</h2>
        <p>
          We may maintain, update or temporarily interrupt the service. We may restrict access where
          reasonably necessary for security, abuse prevention or legal compliance. You may stop
          using Hibiki at any time. Ending your Hibiki account does not by itself cancel an active
          Paddle subscription; cancel the paid subscription separately using the billing portal. We
          will handle account-data requests as described in our{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
      <section>
        <h2>7. Your rights and changes</h2>
        <p>
          Nothing in these terms excludes statutory consumer protections or liability that cannot
          legally be excluded, including for fraud or death or personal injury caused by negligence.
          Any limits on liability apply only to the extent permitted by applicable law. We may
          update the terms as the service changes and will give appropriate notice of material
          changes. Applicable mandatory consumer law remains unaffected.
        </p>
      </section>
      <section>
        <h2>8. Contact</h2>
        <p>
          Operator: {LEGAL_OPERATOR.name}. Contact: {LEGAL_OPERATOR.email}. Please use the{' '}
          <Link href="/contact">Contact page</Link> for full business details.
        </p>
      </section>
    </LegalShell>
  );
}
