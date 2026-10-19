import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal-shell';
import { LEGAL_OPERATOR } from '@/lib/legal/operator';

export const metadata: Metadata = { title: 'Privacy Policy — Hibiki' };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This policy explains how Hibiki handles personal information when you use the website, a
        Hibiki account and the Hibiki Bridge extension. The operator and data controller for Hibiki
        account and learning information is <strong>{LEGAL_OPERATOR.name}</strong>, a sole trader
        trading as {LEGAL_OPERATOR.tradingName}, established in {LEGAL_OPERATOR.establishedIn}, with
        business address {LEGAL_OPERATOR.address} and privacy contact {LEGAL_OPERATOR.privacyEmail}.
        Paddle separately handles transaction data as merchant of record under its own privacy
        notice.
      </p>
      <section>
        <h2>1. Information we process</h2>
        <ul>
          <li>
            <strong>Account and security:</strong> your name, email address, email-verification
            status, authentication provider, encrypted/hashed credentials or identity links,
            sessions and security/rate-limit information. Google sign-in is optional.
          </li>
          <li>
            <strong>Learning activity:</strong> if signed in, eligible study metadata such as video
            identifiers, titles, selected page URLs for Bridge lessons, Watch Later, timestamps,
            practice duration, quiz answers and scores, saved words and contexts, flashcard state,
            preferences and progress. Browser-local work can remain only on your device; an initial
            import to your account requires your choice.
          </li>
          <li>
            <strong>Content and processing requests:</strong> subtitle text and nearby sentences you
            expressly send for translation, difficulty analysis or quizzes; audio segments you
            expressly submit for automatic transcription or Shadowing Match; and technical details
            needed to perform these requests.
          </li>
          <li>
            <strong>Billing:</strong> customer and subscription identifiers, plan status,
            renewal/cancellation dates and verified Paddle events used to enable Pro. Hibiki does
            not store your full payment-card details.
          </li>
          <li>
            <strong>Technical and support information:</strong> IP and request metadata processed
            for security, diagnostics and rate limits, plus messages you send us for support.
          </li>
        </ul>
      </section>
      <section>
        <h2>2. What stays on your device</h2>
        <p>
          Uploaded local video files and recordings are not hosted as a video library by Hibiki.
          Personal media, private subtitle imports and translation caches ordinarily remain
          browser-local. Recording and media bytes are sent to cloud transcription/analysis services
          only when you explicitly use those functions; selected audio snippets are transmitted for
          processing. Public provider captions and eligible generated learning artifacts may be
          shared and cached by Hibiki for reuse. The extension handles selected page URLs,
          accessible caption cues and playback data as described in the{' '}
          <a href="/extension-privacy.html">Hibiki Bridge privacy notice</a>.
        </p>
      </section>
      <section>
        <h2>3. Why we process data and our legal bases</h2>
        <ul>
          <li>
            <strong>Contract:</strong> to register and authenticate accounts, provide the features
            and sync you request, administer Pro entitlements and respond to service requests.
          </li>
          <li>
            <strong>Legitimate interests:</strong> to prevent abuse, protect account security,
            diagnose service reliability problems and respond to support requests, where these
            interests are not overridden by your rights.
          </li>
          <li>
            <strong>Legal obligation:</strong> where applicable, to handle required records,
            compliance or valid legal requests.
          </li>
          <li>
            <strong>Consent or another applicable basis:</strong> where legally required for
            non-essential browser storage, marketing or a particular optional processing activity.
            You may withdraw consent where applicable.
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Providers and recipients</h2>
        <p>
          Hibiki runs on Cloudflare Workers and D1; uses Resend for account emails; offers Google
          sign-in; and uses Paddle for subscription checkout and billing. Japanese-video
          integrations may connect your browser with YouTube, Vimeo or the website hosting the
          original video. Optional content analysis and transcription can use Cloudflare Workers AI,
          while translation requests may use an external translation provider (including DeepL or
          MyMemory, according to configured provider). We send to a provider the information needed
          for the operation you requested, not your entire learning library. Each external provider
          may process information under its own applicable privacy policy.
        </p>
      </section>
      <section>
        <h2>5. International processing and retention</h2>
        <p>
          Some service providers may process information outside your country. Where data protection
          law requires safeguards for international transfers, the operator must use an applicable
          lawful transfer mechanism. Contact the privacy address above for further information about
          relevant providers and safeguards.
        </p>
        <p>
          Account and synced learning records are generally retained while your account is active,
          until they are deleted or no longer needed. Short-lived security records, backups, service
          logs and cache entries are retained based on operational need and security requirements.
          Paddle and other suppliers may independently keep financial and statutory records for
          longer where required by law. Local-browser data stays until cleared through Hibiki or
          your browser. Specific retention periods and deletion procedures must be reviewed before
          publication.
        </p>
      </section>
      <section>
        <h2>6. Your controls and rights</h2>
        <p>
          Signed-in learners can use the Account page to download available personal learning data.
          You may also request access, correction, deletion, restriction, portability or objection
          as applicable to your circumstances and jurisdiction.
          <strong>
            {' '}
            You have the right to object to processing based on legitimate interests.
          </strong>
          Some requests may be limited by legal retention duties and other lawful exceptions. To
          request erasure or ask about a transfer safeguard, contact {LEGAL_OPERATOR.privacyEmail}.
          Clearing browser storage does not automatically delete cloud account records, and deleting
          the extension does not remove your Hibiki account.
        </p>
        <p>
          If UK data protection law applies, you can complain to the{' '}
          <a href="https://ico.org.uk/make-a-complaint/">Information Commissioner&apos;s Office</a>.
        </p>
      </section>
      <section>
        <h2>7. Cookies and changes</h2>
        <p>
          Read our <Link href="/cookies">Cookie &amp; Local Storage Policy</Link> for
          authentication, theme and browser learning storage. We may update this notice as features
          and processors change, and will communicate material changes when required.
        </p>
      </section>
    </LegalShell>
  );
}
