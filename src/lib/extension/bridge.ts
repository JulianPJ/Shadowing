'use client';
import type { Cue } from '../types';

/**
 * Hibiki's side of Hibiki Bridge, the browser extension that plays videos on other web pages.
 * The extension injects a content script into Hibiki pages only; it relays these window messages
 * to the extension, which acts only on tabs the learner connected from the extension's popup.
 */
export const PAGE_SOURCE = 'hibiki-page';
export const BRIDGE_SOURCE = 'hibiki-bridge';

export type PageMediaState = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  playbackRate: number;
};
export type BridgeTrack = { label: string; language: string; cues: Cue[] };
export type PendingPageImport = {
  tabId: number;
  pageUrl: string;
  title: string;
  duration: number;
  tracks: BridgeTrack[];
};
export type BridgeEvent =
  | { event: 'media-state'; tabId: number; data: PageMediaState }
  | {
      event: 'capture-chunk';
      tabId: number;
      data: { index: number; start: number; end: number; audio: string };
    }
  | { event: 'capture-end'; tabId: number; data: { reason: 'ended' | 'stopped' } }
  | { event: 'capture-error'; tabId: number; data: { message: string } }
  | { event: 'tab-closed'; tabId: number }
  | { event: 'tab-connected'; tabId: number; data: { pageUrl: string } };

export class BridgeUnavailable extends Error {
  constructor() {
    super('Hibiki Bridge is not responding. Check that the extension is installed and enabled.');
  }
}

type Call = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const calls = new Map<string, Call>();
const listeners = new Set<(event: BridgeEvent) => void>();
let installed = false;
let version: Promise<string | null> | null = null;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', (message: MessageEvent) => {
    // Only the extension's content script, running in this page, speaks for the bridge.
    if (message.source !== window || message.origin !== window.location.origin) return;
    const data = message.data as Record<string, unknown> | null;
    if (!data || data.source !== BRIDGE_SOURCE) return;
    if (typeof data.id === 'string') {
      const call = calls.get(data.id);
      if (!call) return;
      calls.delete(data.id);
      clearTimeout(call.timer);
      if (typeof data.error === 'string') call.reject(new Error(data.error));
      else call.resolve(data.result);
      return;
    }
    if (typeof data.event === 'string')
      for (const listener of listeners) listener(data as unknown as BridgeEvent);
  });
}

export function bridgeRequest<T>(
  command: string,
  args: Record<string, unknown> = {},
  timeoutMs = 10000,
): Promise<T> {
  install();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      calls.delete(id);
      reject(new BridgeUnavailable());
    }, timeoutMs);
    calls.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    window.postMessage({ source: PAGE_SOURCE, id, command, args }, window.location.origin);
  });
}

/** The installed extension's version, or null when Hibiki Bridge is not available. */
export function bridgeVersion(timeoutMs = 800): Promise<string | null> {
  version ??= bridgeRequest<{ version: string }>('hello', {}, timeoutMs).then(
    (result) => result.version,
    () => {
      version = null;
      return null;
    },
  );
  return version;
}

export function onBridgeEvent(listener: (event: BridgeEvent) => void) {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
