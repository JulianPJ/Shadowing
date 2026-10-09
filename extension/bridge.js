// Runs only on Hibiki pages. Relays the page's requests to the extension and the extension's
// responses and video events back to the page. Other sites never see this script.
(() => {
  const PAGE = 'hibiki-page';
  const BRIDGE = 'hibiki-bridge';
  let port = null;

  function connect() {
    port = chrome.runtime.connect({ name: 'hibiki-bridge' });
    port.onMessage.addListener((message) => {
      if (message.type === 'response')
        window.postMessage(
          { source: BRIDGE, id: message.id, result: message.result, error: message.error },
          location.origin,
        );
      else if (message.type === 'event')
        window.postMessage(
          { source: BRIDGE, event: message.event, tabId: message.tabId, data: message.data },
          location.origin,
        );
    });
    // The service worker can restart; reconnect on the next request.
    port.onDisconnect.addListener(() => {
      port = null;
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE || typeof data.id !== 'string') return;
    if (typeof data.command !== 'string') return;
    try {
      if (!port) connect();
      port.postMessage({
        type: 'request',
        id: data.id,
        command: data.command,
        args: data.args ?? {},
      });
    } catch {
      window.postMessage(
        { source: BRIDGE, id: data.id, error: 'Hibiki Bridge was updated. Reload this page.' },
        location.origin,
      );
    }
  });
  connect();
})();
