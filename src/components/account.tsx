'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth/client';
import { authPath } from '@/lib/auth/return-path';
import { reviewSync } from '@/lib/review/client';
import { knowledgeSync } from '@/lib/knowledge/client';
import { discoverSync, startDiscoverEvents } from '@/lib/discover/client';
import { startChannels } from '@/lib/sync/channel';
import {
  chooseImport,
  refreshAccount,
  startSync,
  subscribeSync,
  syncStatus,
} from '@/lib/sync/client';
import type { SyncStatus } from '@/lib/sync/client';
import {
  channelStatus,
  initialChannels,
  sessionExpired,
  subscribeChannels,
} from '@/lib/sync/channel-status';
import { useTaskReturn } from './task-return';
const initial: SyncStatus = {
  user: null,
  state: 'local',
  loaded: false,
  error: '',
  lastSync: null,
  importPending: false,
  googleEnabled: false,
  emailEnabled: false,
};
export function useAccount() {
  return useSyncExternalStore(subscribeSync, syncStatus, () => initial);
}
function useSessionExpired() {
  return sessionExpired(
    useSyncExternalStore(subscribeChannels, channelStatus, () => initialChannels),
  );
}

/**
 * Starts background sync and asks once before importing anonymous device progress.
 * Sync is otherwise silent: the only visible state is an expired session that needs sign-in.
 */
export function AccountBridge() {
  const account = useAccount();
  const expired = useSessionExpired();
  const { destination } = useTaskReturn();
  const [busy, setBusy] = useState(false);
  useEffect(() => startSync(), []);
  useEffect(() => startChannels([reviewSync, knowledgeSync, discoverSync]), []);
  useEffect(() => startDiscoverEvents(), []);
  if (account.user && expired)
    return (
      <aside className="account-import" aria-label="Session expired" role="status">
        <strong>Your session expired.</strong>
        <p>Your practice is saved on this device. Sign in again to keep it in sync.</p>
        <div>
          <Link className="button primary" href={authPath('/sign-in', destination)}>
            Sign in again
          </Link>
        </div>
      </aside>
    );
  return account.importPending ? (
    <aside className="account-import" aria-label="Import device progress">
      <strong>Add this device’s Hibiki progress to your account?</strong>
      <p>
        Includes your practice history, quiz answers, bookmarks and word states. Media, recordings
        and transcripts stay on this device either way.
      </p>
      <div>
        {[
          [true, 'Add device progress'],
          [false, 'Keep it on this device'],
        ].map(([accept, label]) => (
          <button
            key={String(accept)}
            className={`button${accept ? ' primary' : ''}`}
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await chooseImport(accept as boolean);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Please wait…' : label}
          </button>
        ))}
      </div>
    </aside>
  ) : null;
}

export function PlanComparison() {
  return (
    <section className="plan-comparison" id="plans" aria-labelledby="plan-comparison-title">
      <h2 id="plan-comparison-title">Free and Pro</h2>
      <dl>
        <div>
          <dt>Hibiki Free</dt>
          <dd>
            Shadowing, recording, dictionary lookup, saved words and review, with progress synced to
            your account.
          </dd>
        </div>
        <div>
          <dt>Hibiki Pro</dt>
          <dd>
            Everything in Free, plus comprehension checks, topic vocabulary, automatic subtitles and
            Shadowing Match analysis.
          </dd>
        </div>
      </dl>
      <p className="muted">
        Online subscriptions are not available yet. Pro access is available to accounts that have
        already been enabled; sign in with that account to use it.
      </p>
    </section>
  );
}

/** Sign-in, plan and sign-in methods. Rendered at the bottom of the Profile page. */
export function AccountSettings() {
  const account = useAccount();
  const { destination } = useTaskReturn();
  const [methods, setMethods] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = account.user?.id;
  useEffect(() => {
    let active = true;
    if (owner)
      void authClient
        .listAccounts()
        .then((result) => {
          if (active) setMethods(result.data ? result.data.map((item) => item.providerId) : []);
        })
        .catch(() => {
          if (active) setMethods([]);
        });
    return () => {
      active = false;
    };
  }, [owner]);
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch {
      setMessage('Could not complete this account action. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (!account.loaded)
    return (
      <section className="account-settings" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <p role="status">Checking your account…</p>
      </section>
    );
  if (!account.user)
    return (
      <section className="account-settings" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <p>Sign in to save words and keep your progress across devices.</p>
        <Link className="button primary" href={authPath('/sign-in', destination)}>
          Sign in
        </Link>
        {account.error ? (
          <p role="status">
            Account services are temporarily unavailable. You can keep practising.
          </p>
        ) : null}
        <PlanComparison />
      </section>
    );
  return (
    <section className="account-settings" aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <p className="account-email">{account.user.email}</p>
      <span className={`account-plan ${account.user.plan === 'pro' ? 'pro' : ''}`}>
        {account.user.plan === 'pro' ? 'Hibiki Pro' : 'Hibiki Free'}
      </span>
      {!account.user.emailVerified ? (
        <div className="account-verify" role="status">
          <p>Verify your email to save words and sync across devices.</p>
          {account.emailEnabled ? (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await authClient.sendVerificationEmail({
                    email: account.user!.email,
                    callbackURL: '/profile',
                  });
                  setMessage(result.error?.message ?? 'Check your inbox for a verification link.');
                })
              }
            >
              Resend verification email
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="muted">
        Sign-in methods:{' '}
        {methods === null
          ? 'Loading…'
          : methods.length
            ? methods
                .map((method) =>
                  method === 'credential'
                    ? 'Email and password'
                    : method === 'google'
                      ? 'Google'
                      : method,
                )
                .join(', ')
            : 'Could not load sign-in methods.'}
      </p>
      <div className="account-actions">
        {account.googleEnabled && methods && !methods.includes('google') ? (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await authClient.linkSocial({
                  provider: 'google',
                  callbackURL: '/profile',
                });
                if (result.error) setMessage(result.error.message ?? 'Could not link Google.');
              })
            }
          >
            Connect Google
          </button>
        ) : null}
        {account.emailEnabled && methods && !methods.includes('credential') ? (
          <Link className="button" href={authPath('/reset-password', destination)}>
            Add email sign-in
          </Link>
        ) : null}
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const result = await authClient.signOut();
              if (result.error) setMessage('Could not sign out. Try again.');
              else await refreshAccount();
            })
          }
        >
          Sign out
        </button>
      </div>
      {message ? <p role="alert">{message}</p> : null}
      <PlanComparison />
    </section>
  );
}
