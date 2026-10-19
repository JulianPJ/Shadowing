import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'Cookies & Local Storage — Hibiki' };

export default function CookiesPage() {
  return (
    <LegalShell title="Cookie & Local Storage Policy">
      <p>
        Hibiki uses browser cookies and local device storage to keep the website
        working and preserve your learning preferences. This notice also describes
        related third-party services. See our <Link href="/privacy">Privacy Policy</Link>
        {' '}for personal information and account-data processing.
      </p>
      <section>
        <h2>Cookies used by the Hibiki website</h2>
        <ul>
          <li>
            <strong>Sign-in and security:</strong> Better Auth sets cookies to
            authenticate your session, secure account actions and maintain sign-in.
            The server-side session is configured to expire after 14 days, with
            periodic session updates. These are necessary for the account service
            you request.
          </li>
          <li>
            <strong>Theme choice:</strong> the <code>hibiki-theme</code> cookie
            remembers whether you chose light or dark mode.
          </li>
        </ul>
      </section>
      <section>
        <h2>Other browser storage</h2>
        <p>
          Hibiki stores local lesson references, subtitles, playback positions,
          translation caches, preferences, study progress and other learning data
          in your browser. This supports anonymous and offline-friendly practice.
          Signed-in learners may separately synchronise eligible learning metadata
          to the Hibiki account database, with a choice before importing existing
          anonymous progress. Hibiki Bridge uses Chrome local and session storage
          for its selected Hibiki origin and temporary video connections.
        </p>
      </section>
      <section>
        <h2>Third-party players and checkout</h2>
        <p>
          Loading a YouTube or Vimeo player, using Google sign-in or opening Paddle
          checkout may cause those providers to use their own cookies or similar
          technologies under their own policies. These are distinct from the
          Hibiki theme and account session cookies. Playback of third-party media
          may also involve direct connections from your browser to the media provider.
        </p>
      </section>
      <section>
        <h2>Choice and consent</h2>
        <p>
          Strictly necessary cookies can be used to provide authentication and
          security. Non-essential storage may require your consent under applicable
          law. The current Hibiki application has no separately configured
          advertising tracker in its source; the operator must audit the final
          deployed scripts and embedded providers before publication. If
          non-essential analytics or advertising technologies are introduced,
          an appropriate consent choice must be implemented before enabling them.
        </p>
        <p>
          You can clear cookies and local storage in your browser settings, or
          remove selected learning records through supported Hibiki controls.
          Clearing local storage may remove unsynchronised lessons and preferences
          and can sign you out. Clearing device storage does not automatically
          erase your server-side account information.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          We will update this policy if cookie or storage practices change, and
          will request any legally required consent before using new non-essential
          technologies.
        </p>
      </section>
    </LegalShell>
  );
}
