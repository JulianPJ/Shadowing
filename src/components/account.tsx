'use client';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth/client';
import { authPath } from '@/lib/auth/return-path';
import { refreshReview, startReviewSync } from '@/lib/review/client';
import { syncWordKnowledge, startKnowledgeSync } from '@/lib/knowledge/client';
import { syncDiscover, startDiscoverSync } from '@/lib/discover/client';
import {
  chooseImport,
  refreshAccount,
  startSync,
  subscribeSync,
  synchronize,
  syncStatus,
} from '@/lib/sync/client';
import type { SyncStatus } from '@/lib/sync/client';
import {
  aggregateSync,
  channelStatus,
  initialChannels,
  subscribeChannels,
} from '@/lib/sync/channel-status';
import { StandaloneNavigation } from './chrome';
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
export function useAggregateSync() {
  const channels = useSyncExternalStore(subscribeChannels, channelStatus, () => initialChannels);
  return { ...aggregateSync(channels), channels };
}
async function retrySync() {
  await Promise.allSettled([synchronize(), refreshReview(), syncWordKnowledge(), syncDiscover()]);
}
export function AccountBridge() {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  useEffect(() => startSync(), []);
  useEffect(() => startReviewSync(), []);
  useEffect(() => startKnowledgeSync(), []);
  useEffect(() => startDiscoverSync(), []);
  return account.importPending ? (
    <aside className="account-import" aria-label="Import device progress">
      <strong>Add this device’s Hibiki progress to your account?</strong>
      <p>
        Include preferences, practice history, quiz answers, bookmarks and word knowledge states.
        Media, recordings, transcript text and playback links stay on this device. Either choice
        keeps your anonymous history on this device.
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
export function AccountEntry({ drawer = true }: { drawer?: boolean }) {
  const account = useAccount();
  const sync = useAggregateSync();
  const { destination } = useTaskReturn();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function close() {
    setOpen(false);
    dialog.current?.close();
    trigger.current?.focus();
  }
  return (
    <>
      <Link
        ref={trigger}
        className="nav-link account-entry"
        href={account.user ? '/account' : authPath('/sign-in', destination)}
        onClick={(event) => {
          if (drawer && account.user && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {account.user ? 'Account' : 'Sign in'}
        {account.user &&
        ['offline', 'error', 'auth', 'conflict', 'pending'].includes(sync.state) ? (
          <span className="sync-dot" aria-label="Account sync needs attention" />
        ) : null}
      </Link>
      <dialog
        ref={dialog}
        className="account-drawer"
        aria-label="Your account"
        onCancel={close}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <button className="icon-button dialog-close" aria-label="Close account" onClick={close}>
          <X size={20} />
        </button>
        {open ? <AccountDetails compact /> : null}
        <Link className="button full-width" href="/account" onClick={close}>
          Account settings and plans
        </Link>
      </dialog>
    </>
  );
}
export function PlanComparison() {
  return (
    <section className="plan-comparison" id="plans" aria-labelledby="plan-comparison-title">
      <h2 id="plan-comparison-title">Free and Pro</h2>
      <dl>
        <div>
          <dt>Hibiki Free</dt>
          <dd>
            Shadowing, replay and local recording; dictionary lookup and word knowledge. A Free
            account adds saved words, decks, review and eligible progress sync.
          </dd>
        </div>
        <div>
          <dt>Hibiki Pro</dt>
          <dd>
            Everything in Free, plus generated comprehension checks, topic vocabulary, automatic
            subtitles for your own media and Shadowing Match analysis.
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
function AccountDetails({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const sync = useAggregateSync();
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
  if (!account.loaded) return <p role="status">Checking your account…</p>;
  if (!account.user)
    return (
      <>
        <p>Sign in to save words and keep eligible practice progress across devices.</p>
        <Link className="button primary" href={authPath('/sign-in', destination)}>
          Continue to sign in
        </Link>
        {account.error ? (
          <p role="status">
            Account services are temporarily unavailable. You can keep practising.
          </p>
        ) : null}
      </>
    );
  return (
    <>
      {compact ? <h2>Your account</h2> : null}
      <p className="account-email">{account.user.email}</p>
      <span className={`account-plan ${account.user.plan === 'pro' ? 'pro' : ''}`}>
        {account.user.plan === 'pro' ? 'Hibiki Pro' : 'Hibiki Free'}
      </span>
      <section className="account-sync" aria-label="Automatic sync">
        <h2>Automatic sync</h2>
        <p role="status">{sync.message}</p>
        {sync.pending ? (
          <p className="small muted">
            {sync.pending} pending {sync.pending === 1 ? 'change' : 'changes'}
          </p>
        ) : null}
        {sync.lastSync ? (
          <p className="small muted">Last synced {new Date(sync.lastSync).toLocaleString()}</p>
        ) : null}
        {sync.state === 'auth' ? (
          <Link className="button primary" href={authPath('/sign-in', destination)}>
            Sign in again
          </Link>
        ) : null}
        {sync.state === 'conflict' ? (
          <Link className="button" href="/review">
            Check review changes
          </Link>
        ) : null}
        <button
          className="button"
          disabled={busy || sync.state === 'syncing'}
          onClick={() => void action(retrySync)}
        >
          {busy ? 'Retrying…' : 'Sync now'}
        </button>
      </section>
      <p className="muted">
        Connected sign-in methods:{' '}
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
        {!compact && account.googleEnabled && methods && !methods.includes('google') ? (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await authClient.linkSocial({
                  provider: 'google',
                  callbackURL: '/account',
                });
                if (result.error) setMessage(result.error.message ?? 'Could not link Google.');
              })
            }
          >
            Connect Google
          </button>
        ) : null}
        {!compact && account.emailEnabled && methods && !methods.includes('credential') ? (
          <Link className="button" href={authPath('/reset-password', destination)}>
            Add email sign-in
          </Link>
        ) : null}
        <Link className="button" href="/progress">
          View progress
        </Link>
        <Link className="button" href="/dictionary">
          Saved words
        </Link>
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
      {!compact ? <PlanComparison /> : null}
    </>
  );
}
export function AccountPage() {
  return (
    <>
      <StandaloneNavigation />
      <main className="account-screen">
        <h1>Your account</h1>
        <AccountDetails />
        <p className="small muted">
          Recordings and private transcripts stay on your device. Saving vocabulary sends only your
          selected words and sentence context to your account.
        </p>
      </main>
    </>
  );
}
