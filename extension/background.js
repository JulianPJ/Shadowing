import { canonicalYouTubeUrl } from './youtube.js';
import { loadPlayerTracks, playerSource } from './page-player.js';
import { describeVideos } from './page-videos.js';

// Hibiki Bridge service worker. It only ever controls tabs the learner connected from the popup,
// and only Hibiki pages (where bridge.js runs) can send it commands.
const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_ORIGIN = 'https://hibikiapp.net';
// bridge.js only runs on these origins (see manifest.json), so Hibiki must be one of them.
const ALLOWED_ORIGIN =
  /^(https:\/\/hibikiapp\.net|https:\/\/shadowing\.julianpopovskijones\.workers\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;
const bridges = new Set();
const controllers = new Map();

// Service workers restart; connected tabs, page streams, tabs opened for pasted links and the
// pending import live in session storage.
async function state() {
  const {
    connected = {},
    pendingImport = null,
    waiting = {},
    streams = {},
    opened = [],
  } = await chrome.storage.session.get([
    'connected',
    'pendingImport',
    'waiting',
    'streams',
    'opened',
  ]);
  return { connected, pendingImport, waiting, streams, opened };
}
const save = (values) => chrome.storage.session.set(values);
async function hibikiOrigin() {
  const { origin } = await chrome.storage.local.get('origin');
  return typeof origin === 'string' ? origin : DEFAULT_ORIGIN;
}
const pageKey = (url) => {
  try {
    const value = new URL(url);
    value.hash = '';
    return value.href;
  } catch {
    return null;
  }
};
const samePage = (a, b) => pageKey(a) !== null && pageKey(a) === pageKey(b);

function broadcast(event, tabId, data) {
  for (const port of bridges) {
    try {
      port.postMessage({ type: 'event', event, tabId, data });
    } catch {
      bridges.delete(port);
    }
  }
}

async function toController(tabId, message) {
  const { connected } = await state();
  const entry = connected[tabId];
  if (!entry)
    throw new Error('That video tab is no longer connected. Open it and click Hibiki Bridge.');
  const response = await chrome.tabs
    .sendMessage(Number(tabId), { type: 'command', ...message }, { frameId: entry.frameId })
    .catch(() => {
      throw new Error('The video page stopped responding. Reload it and connect again.');
    });
  if (!response) throw new Error('The video page stopped responding. Reload it and connect again.');
  if (response.error) throw new Error(response.error);
  return response.result;
}

async function forget(tabId) {
  const { connected } = await state();
  if (!connected[tabId]) return;
  delete connected[tabId];
  await save({ connected });
  broadcast('tab-closed', Number(tabId));
}

/** Injects the controller into the frame holding the chosen video and describes it. */
async function attach(tabId, frameId, videoIndex, pageUrl) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ['controller.js'],
  });
  const response = await chrome.tabs.sendMessage(
    tabId,
    { type: 'command', action: 'select', value: videoIndex },
    { frameId },
  );
  if (!response || response.error)
    throw new Error(response?.error || 'The video could not be selected.');
  const stream = await probeStream(tabId, frameId, videoIndex, response.result.media);
  const { connected, waiting, streams } = await state();
  connected[tabId] = { frameId, pageUrl, videoIndex };
  if (stream) streams[pageKey(pageUrl)] = stream;
  await save({ connected, streams });
  return { description: response.result, waiting };
}

/** Connects the chosen video and describes it for Hibiki's import: length and subtitles. */
async function handOff(tabId, frameId, videoIndex, pageUrl, title) {
  const { description } = await attach(tabId, frameId, videoIndex, pageUrl);
  const loaded = await playerTracks(tabId, frameId, videoIndex);
  const same = (a, b) => a.label === b.label && a.language === b.language;
  return {
    tabId,
    pageUrl,
    title: title || description.title,
    duration: description.duration,
    tracks: [...loaded, ...description.tracks.filter((t) => !loaded.some((p) => same(t, p)))],
  };
}

/**
 * The largest video with a known length in a tab opened for a pasted link. Some players load
 * only once they are visible, so after a few seconds the tab is shown until its video appears,
 * then Hibiki's tab comes back.
 */
async function findVideo(tabId, hibikiTab) {
  let shown = false;
  const back = () =>
    shown && hibikiTab !== undefined
      ? chrome.tabs.update(hibikiTab, { active: true }).catch(() => {})
      : undefined;
  for (let waited = 0; waited < 25000; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!shown && waited >= 6000) {
      shown = true;
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
    const frames = await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, func: describeVideos })
      .catch(() => []);
    const [video] = frames
      .flatMap((frame) => (frame.result ?? []).map((v) => ({ ...v, frameId: frame.frameId })))
      .filter((v) => v.duration > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    if (video) {
      await back();
      return video;
    }
  }
  await back();
  return null;
}

/** Runs one of page-player.js's functions in the page's own world; null if it cannot. */
async function inPage(tabId, frameId, func, args) {
  const [injection] = await chrome.scripting
    .executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func, args })
    .catch(() => []);
  return injection?.result ?? null;
}

/** Japanese subtitles the page's own player loads only on request. */
async function playerTracks(tabId, frameId, videoIndex) {
  const tracks = await inPage(tabId, frameId, loadPlayerTracks, [videoIndex]);
  return Array.isArray(tracks) ? tracks : [];
}

/**
 * The chosen video's stream, if Hibiki can play it itself: the page's file or HLS playlist, the
 * origin that requests it and the hosts it is served from. Players that feed the video from
 * script with no playlist to fetch (or with DRM) have none and keep playing in their own tab.
 */
async function probeStream(tabId, frameId, videoIndex, context) {
  // A sandboxed frame's opaque origin cannot be replayed; that video stays in its tab.
  if (!/^https?:\/\//.test(context?.origin ?? '')) return null;
  const player = await inPage(tabId, frameId, playerSource, [videoIndex]);
  const http = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
  const url = [player?.src, context.src, ...(context.playlists ?? [])].find(http);
  if (!url) return null;
  const path = new URL(url).pathname;
  if (/\.mpd$/i.test(path)) return null;
  const hls = /\.m3u8$/i.test(path) || (url === player?.src && /mpegurl/i.test(player.type));
  return {
    url,
    type: hls ? 'hls' : 'file',
    origin: context.origin,
    hosts: [...new Set([new URL(url).hostname, ...(context.hosts ?? [])])].slice(0, 30),
  };
}

/**
 * Lets one Hibiki tab request a page's stream the way the page does: its requests to the stream's
 * hosts carry the page's origin, and the answers may be read by Hibiki. Nothing else changes.
 */
async function allowStream(tabId, hibiki, stream) {
  const own = new URL(hibiki).hostname;
  const hosts = stream.hosts.filter((host) => host !== own);
  if (!hosts.length) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: 1,
        condition: {
          tabIds: [tabId],
          initiatorDomains: [own],
          requestDomains: hosts,
          resourceTypes: ['xmlhttprequest', 'media'],
        },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: stream.origin },
            { header: 'referer', operation: 'set', value: `${stream.origin}/` },
          ],
          responseHeaders: [
            { header: 'access-control-allow-origin', operation: 'set', value: hibiki },
          ],
        },
      },
    ],
  });
}

const commands = {
  hello: async () => ({ version: VERSION }),
  'pending-import': async () => {
    const { pendingImport } = await state();
    await save({ pendingImport: null });
    return pendingImport;
  },
  // A saved page lesson asks for its page; the popup offers to connect it when it is opened.
  connect: async ({ pageUrl }, sender) => {
    const { connected, waiting } = await state();
    const match = Object.entries(connected).find(([, entry]) => samePage(entry.pageUrl, pageUrl));
    if (match)
      return { tabId: Number(match[0]), state: await toController(match[0], { action: 'state' }) };
    waiting[pageUrl] = sender.tab?.id ?? null;
    await save({ waiting });
    return { tabId: null };
  },
  media: ({ tabId, action, value }) => toController(tabId, { action, value }),
  subtitle: ({ tabId, text }) => toController(tabId, { action: 'subtitle', value: text }),
  'capture-start': ({ tabId, windows }) =>
    toController(tabId, { action: 'capture-start', value: windows }),
  'capture-stop': ({ tabId }) => toController(tabId, { action: 'capture-stop' }),
  // Hibiki plays the page's own stream itself when it can. A stream found earlier is reused, so
  // the page tab may already be closed; otherwise a connected page tab is asked again.
  stream: async ({ pageUrl }, sender) => {
    const key = pageKey(pageUrl);
    const hibikiTab = sender.tab?.id;
    if (!key || hibikiTab === undefined) return null;
    const { connected, streams } = await state();
    const match = Object.entries(connected).find(([, entry]) => samePage(entry.pageUrl, pageUrl));
    let stream = streams[key];
    if (!stream && match) {
      const [tabId, entry] = match;
      const context = await toController(tabId, { action: 'context' }).catch(() => null);
      stream = await probeStream(Number(tabId), entry.frameId, entry.videoIndex, context);
      if (stream) await save({ streams: { ...(await state()).streams, [key]: stream } });
    }
    if (!stream) return null;
    const origins = stream.hosts.map((host) => `*://${host}/*`);
    if (!(await chrome.permissions.contains({ origins }).catch(() => false))) return null;
    await allowStream(hibikiTab, sender.origin ?? new URL(sender.url).origin, stream);
    // Hibiki takes over, so the page's own copy stops rather than playing alongside.
    if (match) await toController(match[0], { action: 'pause' }).catch(() => {});
    return { url: stream.url, type: stream.type };
  },
  // A link pasted into Hibiki: open its page in a background tab, find the video and hand it over
  // as Practise in the popup does. It needs the all-sites access the popup asks for once.
  'open-page': async ({ pageUrl }, sender) => {
    const url = pageKey(pageUrl);
    if (!url || !/^https?:\/\//i.test(url))
      throw new Error('Paste the address of a web page with a video.');
    if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] })))
      return { needsAccess: true };
    const tab = await chrome.tabs.create({
      url,
      active: false,
      ...(sender.tab
        ? { windowId: sender.tab.windowId, index: sender.tab.index + 1, openerTabId: sender.tab.id }
        : {}),
    });
    try {
      const video = await findVideo(tab.id, sender.tab?.id);
      if (!video)
        throw new Error(
          'No video was found on that page. Open it, start the video and click Hibiki Bridge.',
        );
      const page = await chrome.tabs.get(tab.id);
      const pending = await handOff(
        tab.id,
        video.frameId,
        video.index,
        page.url || url,
        page.title,
      );
      const { opened } = await state();
      await save({ opened: [...opened, tab.id] });
      return pending;
    } catch (error) {
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
  },
  // Hibiki is playing the page's stream itself, so a tab opened only for a pasted link closes.
  'stream-ready': async ({ pageUrl }) => {
    const { connected, opened } = await state();
    for (const [tabId, entry] of Object.entries(connected))
      if (samePage(entry.pageUrl, pageUrl) && opened.includes(Number(tabId)))
        await chrome.tabs.remove(Number(tabId)).catch(() => {});
    return true;
  },
  // The stream expired or would not play; the next request asks the page again.
  'stream-failed': async ({ pageUrl }) => {
    const { streams } = await state();
    delete streams[pageKey(pageUrl)];
    await save({ streams });
    return true;
  },
  focus: async ({ tabId }) => {
    const { connected } = await state();
    if (!connected[tabId]) throw new Error('That video tab is no longer connected.');
    const tab = await chrome.tabs.update(Number(tabId), { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  },
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'hibiki-bridge') {
    bridges.add(port);
    port.onDisconnect.addListener(() => bridges.delete(port));
    port.onMessage.addListener(async (message) => {
      if (message?.type !== 'request') return;
      const handler = commands[message.command];
      try {
        if (!handler) throw new Error('Hibiki Bridge does not support this request. Update it.');
        const result = await handler(message.args ?? {}, port.sender);
        port.postMessage({ type: 'response', id: message.id, result });
      } catch (error) {
        port.postMessage({ type: 'response', id: message.id, error: error.message });
      }
    });
  } else if (port.name === 'hibiki-controller') {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) return port.disconnect();
    controllers.set(tabId, port);
    port.onMessage.addListener((message) => {
      if (message?.type === 'event') broadcast(message.event, tabId, message.data);
    });
    // The page navigated or closed: its video is gone.
    port.onDisconnect.addListener(() => {
      if (controllers.get(tabId) === port) controllers.delete(tabId);
      void forget(tabId);
    });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void forget(tabId);
  // A closed Hibiki tab's stream rule goes with it.
  void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
});

// Popup actions, always for the tab the learner opened the popup on.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'popup') return;
  (async () => {
    const origin = await hibikiOrigin();
    if (message.action === 'status') {
      const { connected, waiting } = await state();
      const waitingFor = Object.keys(waiting).find((url) => samePage(url, message.pageUrl));
      return { connected: !!connected[message.tabId], waiting: !!waitingFor, origin };
    }
    if (message.action === 'youtube-import') {
      // Do not trust a stale popup URL: validate Chrome's current tab URL.
      const tab = await chrome.tabs.get(message.tabId);
      const canonicalUrl = tab?.url === message.pageUrl ? canonicalYouTubeUrl(tab.url) : null;
      if (!canonicalUrl) throw new Error('Open a YouTube video and try again.');
      await chrome.tabs.create({
        url: `${origin}/prepare?video=${encodeURIComponent(canonicalUrl)}`,
      });
      return { ok: true };
    }
    if (message.action === 'import') {
      await save({
        pendingImport: await handOff(
          message.tabId,
          message.frameId,
          message.videoIndex,
          message.pageUrl,
          message.title,
        ),
      });
      await chrome.tabs.create({ url: `${origin}/?bridge=import` });
      return { ok: true };
    }
    if (message.action === 'attach') {
      const { waiting } = await attach(
        message.tabId,
        message.frameId,
        message.videoIndex,
        message.pageUrl,
      );
      const key = Object.keys(waiting).find((url) => samePage(url, message.pageUrl));
      const lessonTab = key ? waiting[key] : null;
      if (key) {
        delete waiting[key];
        await save({ waiting });
      }
      broadcast('tab-connected', message.tabId, { pageUrl: message.pageUrl });
      if (typeof lessonTab === 'number') {
        const tab = await chrome.tabs.update(lessonTab, { active: true }).catch(() => null);
        if (tab) await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { ok: true };
    }
    if (message.action === 'origin') {
      if (!ALLOWED_ORIGIN.test(message.origin))
        throw new Error('Use the Hibiki site or a localhost address.');
      await chrome.storage.local.set({ origin: message.origin });
      return { ok: true };
    }
    throw new Error('Unknown action');
  })().then(
    (result) => sendResponse({ result }),
    (error) => sendResponse({ error: error.message }),
  );
  return true;
});
