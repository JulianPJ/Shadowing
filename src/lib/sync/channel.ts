'use client';
import { storageAccount } from '../storage/browser';
import { syncStatus, subscribeSync } from './client';
import { reportChannel, syncFailure, type SyncChannel } from './channel-status';

/**
 * The shared engine behind every account-synced collection (review, word states, Watch Later).
 * Each channel supplies only its push/pull body; ownership checks, single-flight runs,
 * freshness, cross-tab locking and status reporting live here.
 */

/** Thrown when the signed-in account changes while a request is in flight. */
export class AccountChanged extends Error {
  constructor() {
    super('Account changed');
  }
}

export type AccountRequest = <T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<T>;

export type ChannelContext = {
  owner: string;
  /** False once another account (or none) owns local storage. */
  current: () => boolean;
  /** Account-scoped JSON request. Rejects with `status` and the error body on HTTP errors. */
  request: AccountRequest;
};

export function accountContext(owner: string): ChannelContext {
  const current = () => storageAccount() === owner && syncStatus().user?.id === owner;
  const request: AccountRequest = async (path, { method, body } = {}) => {
    const response = await fetch(path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-Hibiki-Account': owner,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!current()) throw new AccountChanged();
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error('Sync unavailable'), { status: response.status, data });
    }
    const data = await response.json();
    // Never let a response that arrives after an account switch touch the new account's data.
    if (!current()) throw new AccountChanged();
    return data;
  };
  return { owner, current, request };
}

/** Routine refreshes (focus, reconnect, polling) reuse a successful sync for this long. */
export const CHANNEL_FRESH_MS = 5 * 60_000;

export type SyncChannelHandle = {
  /** Runs now unless a run is in flight (the next run is queued) or the channel is fresh. */
  sync: (options?: { force?: boolean }) => Promise<void>;
};

export function createSyncChannel(options: {
  channel: SyncChannel;
  /** Local changes the server has not accepted yet. Any pending change bypasses freshness. */
  pending: () => number;
  run: (context: ChannelContext) => Promise<void>;
  /** Serialise runs across tabs that drain one shared account outbox. */
  lock?: boolean;
  freshMs?: number;
}): SyncChannelHandle {
  const running = new Map<string, Promise<void>>();
  // Owner → whether the queued follow-up was forced.
  const queued = new Map<string, boolean>();
  const synced = new Map<string, number>();
  const freshMs = options.freshMs ?? CHANNEL_FRESH_MS;
  function sync({ force = false }: { force?: boolean } = {}): Promise<void> {
    const owner = storageAccount(),
      user = syncStatus().user;
    // Signed-out data stays on this device. Unverified accounts cannot sync until they verify,
    // and asking anyway would surface a 403 as an expired session.
    if (!owner || user?.id !== owner || !user.emailVerified) return Promise.resolve();
    const active = running.get(owner);
    if (active) {
      queued.set(owner, force || (queued.get(owner) ?? false));
      return active;
    }
    if (!force && !options.pending() && Date.now() - (synced.get(owner) ?? -Infinity) < freshMs)
      return Promise.resolve();
    const context = accountContext(owner);
    reportChannel(owner, options.channel, { state: 'syncing', message: '' });
    const run = () => options.run(context);
    const task = (
      options.lock && typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`hibiki-${options.channel}:${owner}`, run)
        : run()
    )
      .then(() => {
        if (!context.current()) return;
        synced.set(owner, Date.now());
        reportChannel(owner, options.channel, {
          state: options.pending() ? 'pending' : 'saved',
          message: '',
        });
      })
      .catch((error: unknown) => {
        if (context.current()) {
          synced.delete(owner);
          reportChannel(owner, options.channel, syncFailure(error));
        }
        throw error;
      })
      .finally(() => {
        running.delete(owner);
        // Changes made during the run were queued; pending work bypasses freshness, and a forced
        // request stays forced.
        const rerun = queued.get(owner);
        if (queued.delete(owner)) void sync({ force: rerun }).catch(() => {});
      });
    running.set(owner, task);
    return task;
  }
  return { sync };
}

/**
 * One set of triggers for every channel: account changes force a sync; reconnecting, returning
 * to the tab, finished learner hydration and a slow poll are routine and respect freshness.
 */
export function startChannels(channels: SyncChannelHandle[], pollMs = 60_000) {
  let identity = '';
  const each = (force: boolean) => {
    for (const channel of channels) void channel.sync({ force }).catch(() => {});
  };
  const routine = () => {
    if (!document.hidden) each(false);
  };
  const identityChanged = () => {
    const user = syncStatus().user;
    const next = `${storageAccount() ?? ''}:${user?.id ?? ''}:${user?.emailVerified ?? false}`;
    if (next === identity) return;
    identity = next;
    each(true);
  };
  const unsubscribe = subscribeSync(identityChanged);
  const events = ['online', 'focus', 'hibiki:sync-hydrated'];
  for (const event of events) window.addEventListener(event, routine);
  const timer = setInterval(routine, pollMs);
  identityChanged();
  return () => {
    unsubscribe();
    clearInterval(timer);
    for (const event of events) window.removeEventListener(event, routine);
  };
}
