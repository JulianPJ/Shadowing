export type SyncChannel = 'learner' | 'review' | 'knowledge' | 'discovery';
export type ChannelState =
  'idle' | 'syncing' | 'saved' | 'pending' | 'offline' | 'error' | 'auth' | 'conflict';
export type ChannelStatus = {
  state: ChannelState;
  pending: number;
  lastSync: string | null;
  message: string;
};
export type SyncChannels = { owner: string | null } & Record<SyncChannel, ChannelStatus>;
const empty = (): ChannelStatus => ({ state: 'idle', pending: 0, lastSync: null, message: '' });
export const initialChannels: SyncChannels = {
  owner: null,
  learner: empty(),
  review: empty(),
  knowledge: empty(),
  discovery: empty(),
};
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
  snapshot = { owner, learner: empty(), review: empty(), knowledge: empty(), discovery: empty() };
  for (const listener of listeners) listener();
}
export function reportChannel(owner: string, channel: SyncChannel, patch: Partial<ChannelStatus>) {
  if (snapshot.owner !== owner) return;
  const next = { ...snapshot[channel], ...patch };
  if (JSON.stringify(next) === JSON.stringify(snapshot[channel])) return;
  snapshot = { ...snapshot, [channel]: next };
  for (const listener of listeners) listener();
}
export function syncFailure(
  error: unknown,
  online = typeof navigator === 'undefined' || navigator.onLine !== false,
): Pick<ChannelStatus, 'state' | 'message'> {
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
export function aggregateSync(channels: SyncChannels) {
  if (!channels.owner)
    return {
      state: 'local' as const,
      message: 'Saved on this device.',
      pending: 0,
      lastSync: null,
    };
  const all = [channels.learner, channels.review, channels.knowledge, channels.discovery];
  const pending = all.reduce((sum, value) => sum + value.pending, 0);
  const problem =
    all.find((value) => value.state === 'auth') ??
    all.find((value) => value.state === 'conflict') ??
    all.find((value) => value.state === 'error') ??
    all.find((value) => value.state === 'offline');
  const dates = all.map((value) => value.lastSync);
  const lastSync = dates.every((date) => date) ? dates.sort()[0] : null;
  if (problem) return { state: problem.state, message: problem.message, pending, lastSync };
  if (all.some((value) => value.state === 'syncing'))
    return {
      state: 'syncing' as const,
      message: 'Syncing your progress, reviews, word knowledge and Watch Later…',
      pending,
      lastSync,
    };
  if (pending || all.some((value) => value.state === 'pending'))
    return {
      state: 'pending' as const,
      message: `${pending || 'Some'} changes saved on this device are waiting to sync.`,
      pending,
      lastSync,
    };
  if (all.every((value) => value.state === 'saved'))
    return { state: 'saved' as const, message: 'Your progress is synced.', pending, lastSync };
  return {
    state: 'pending' as const,
    message: 'Saved on this device. Checking account sync…',
    pending,
    lastSync,
  };
}
