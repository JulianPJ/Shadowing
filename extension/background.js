// Hibiki Bridge service worker. It only ever controls tabs the learner connected from the popup,
// and only Hibiki pages (where bridge.js runs) can send it commands.
const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_ORIGIN = 'https://shadowing.julianpopovskijones.workers.dev';
// bridge.js only runs on these origins (see manifest.json), so Hibiki must be one of them.
const ALLOWED_ORIGIN =
  /^(https:\/\/shadowing\.julianpopovskijones\.workers\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;
const bridges = new Set();
const controllers = new Map();

// Service workers restart; connected tabs and the pending import live in session storage.
async function state() {
  const {
    connected = {},
    pendingImport = null,
    waiting = {},
  } = await chrome.storage.session.get(['connected', 'pendingImport', 'waiting']);
  return { connected, pendingImport, waiting };
}
const save = (values) => chrome.storage.session.set(values);
async function hibikiOrigin() {
  const { origin } = await chrome.storage.local.get('origin');
  return typeof origin === 'string' ? origin : DEFAULT_ORIGIN;
}
const samePage = (a, b) => {
  try {
    const x = new URL(a),
      y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return false;
  }
};

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
  const { connected, waiting } = await state();
  connected[tabId] = { frameId, pageUrl };
  await save({ connected });
  return { description: response.result, waiting };
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
chrome.tabs.onRemoved.addListener((tabId) => void forget(tabId));

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
    if (message.action === 'import') {
      const { description } = await attach(
        message.tabId,
        message.frameId,
        message.videoIndex,
        message.pageUrl,
      );
      await save({
        pendingImport: {
          tabId: message.tabId,
          pageUrl: message.pageUrl,
          title: message.title || description.title,
          duration: description.duration,
          tracks: description.tracks,
        },
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
