/**
 * Per-channel sync state. Sync is silent in the UI; the only state a learner sees is an expired
 * session, so the other states exist for diagnostics and tests.
 */
export type SyncChannel = 'learner' | 'review' | 'knowledge' | 'discovery';
export type ChannelState =
  'idle' | 'syncing' | 'saved' | 'pending' | 'offline' | 'error' | 'auth' | 'conflict';
export type ChannelStatus = { state: ChannelState; message: string };
export type SyncChannels = { owner: string | null } & Record<SyncChannel, ChannelStatus>;
const empty = (): ChannelStatus => ({ state: 'idle', message: '' });
const channels = (owner: string | null): SyncChannels => ({
  owner,
  learner: empty(),
  review: empty(),
  knowledge: empty(),
  discovery: empty(),
});
export const initialChannels = channels(null);
let snapshot = initialChannels;
const listeners = new Set<() => void>();
export const channelStatus = () => snapshot;
export const subscribeChannels = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function setChannelOwner(owner: string | null) {
  if (snapshot.owner === owner) return;
  snapshot = channels(owner);
  for (const listener of listeners) listener();
}
export function reportChannel(owner: string, channel: SyncChannel, patch: Partial<ChannelStatus>) {
  if (snapshot.owner !== owner) return;
  const next = { ...snapshot[channel], ...patch };
  if (next.state === snapshot[channel].state && next.message === snapshot[channel].message) return;
  snapshot = { ...snapshot, [channel]: next };
  for (const listener of listeners) listener();
}
export function syncFailure(
  error: unknown,
  online = typeof navigator === 'undefined' || navigator.onLine !== false,
): ChannelStatus {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403)
    return { state: 'auth', message: 'Sign in again to sync your saved changes.' };
  if ((error as { conflict?: boolean })?.conflict)
    return {
      state: 'conflict',
      message: 'A review changed on another device. Check its restored schedule.',
    };
  if (!online)
    return {
      state: 'offline',
      message: 'Saved on this device. Sync will retry when you reconnect.',
    };
  return {
    state: 'error',
    message: 'Saved on this device. The sync service is unavailable; try again shortly.',
  };
}
/** True when a signed-in account's session was rejected and the learner must sign in again. */
export const sessionExpired = (status: SyncChannels) =>
  !!status.owner &&
  [status.learner, status.review, status.knowledge, status.discovery].some(
    (channel) => channel.state === 'auth',
  );
