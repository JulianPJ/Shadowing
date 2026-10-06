'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth/client';
import { startReviewSync } from '@/lib/review/client';
import { startKnowledgeSync } from '@/lib/knowledge/client';
import {
  chooseImport,
  refreshAccount,
  startSync,
  subscribeSync,
  synchronize,
  syncStatus,
} from '@/lib/sync/client';
import type { SyncStatus } from '@/lib/sync/client';
const initial: SyncStatus = {
  user: null,
  state: 'local',
  lastSync: null,
  importPending: false,
  googleEnabled: false,
  emailEnabled: false,
};
export function useAccount() {
  return useSyncExternalStore(subscribeSync, syncStatus, () => initial);
}
export function AccountBridge() {
  const account = useAccount();
  useEffect(() => startSync(), []);
  useEffect(() => startReviewSync(), []);
  useEffect(() => startKnowledgeSync(), []);
  return account.importPending ? (
    <aside className="account-import" aria-label="Import device progress">
      <strong>Add this device’s Hibiki progress to your account?</strong>
      <p>
        Include preferences, practice history, quiz answers, bookmarks and word knowledge states.
        Media, recordings, transcript text and playback links stay on this device.
      </p>
      <div>
        <button className="button primary" onClick={() => void chooseImport(true)}>
          Add device progress
        </button>
        <button className="button" onClick={() => void chooseImport(false)}>
          Keep it on this device
        </button>
      </div>
    </aside>
  ) : null;
}
export function AccountEntry() {
  const account = useAccount();
  return (
    <Link className="nav-link account-entry" href={account.user ? '/account' : '/sign-in'}>
      {account.user ? 'Account' : 'Sign in'}
      {account.user && account.state === 'offline' ? (
        <span className="sync-dot" aria-label="Progress waiting to sync" />
      ) : null}
    </Link>
  );
}
export function AccountPage() {
  const account = useAccount(),
    [methods, setMethods] = useState<string[]>([]),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (account.user)
      void authClient.listAccounts().then((result) => {
        if (result.data) setMethods(result.data.map((a) => a.providerId));
      });
  }, [account.user]);
  async function signOut() {
    // Verify sign-out succeeded before changing the local account scope.
    const result = await authClient.signOut();
    if (result.error) setMessage('Could not sign out. Try again.');
    else await refreshAccount();
  }
  async function linkGoogle() {
    const result = await authClient.linkSocial({ provider: 'google', callbackURL: '/account' });
    if (result.error) setMessage(result.error.message ?? 'Could not link Google.');
  }
  return (
    <main className="account-screen">
      <Link className="eyebrow" href="/">
        HIBIKI
      </Link>
      <h1>Your account</h1>
      {account.user ? (
        <>
          <p>{account.user.email}</p>
          <span className={`account-plan ${account.user.plan === 'pro' ? 'pro' : ''}`}>
            {account.user.plan === 'pro' ? 'Hibiki Pro' : 'Hibiki Free'}
          </span>
          <p className="muted">
            Connected sign-in methods:{' '}
            {methods
              .map((m) =>
                m === 'credential' ? 'Email and password' : m === 'google' ? 'Google' : m,
              )
              .join(', ') || 'Loading…'}
          </p>
          <p role="status">
            {account.state === 'offline'
              ? 'Progress is saved on this device. Sync will retry when you reconnect.'
              : account.state === 'syncing'
                ? 'Syncing your progress…'
                : 'Your progress is synced.'}
          </p>
          {account.lastSync ? (
            <p className="small muted">Last synced {new Date(account.lastSync).toLocaleString()}</p>
          ) : null}
          <div className="account-actions">
            <button className="button" onClick={() => void synchronize()}>
              Sync now
            </button>
            {account.googleEnabled && !methods.includes('google') ? (
              <button className="button" onClick={() => void linkGoogle()}>
                Connect Google
              </button>
            ) : null}
            {!methods.includes('credential') ? (
              <Link className="button" href="/reset-password">
                Add email sign-in
              </Link>
            ) : null}
            <button className="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <div className="account-actions">
            <Link className="button primary" href="/progress">
              View progress
            </Link>
            <Link className="button" href="/dictionary">
              Personal dictionary
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>Sign in to keep your practice progress across devices.</p>
          <Link className="button primary" href="/sign-in">
            Sign in
          </Link>
        </>
      )}
      {message ? <p role="alert">{message}</p> : null}
      <p className="small muted">
        Anonymous practice stays available. Audio recordings and private transcripts stay on your
        device unless you explicitly save selected vocabulary and its sentence context to your
        personal dictionary.
      </p>
    </main>
  );
}
