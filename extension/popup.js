// Lists the videos on the current page and hands the chosen one to Hibiki.
const statusLine = document.getElementById('status');
const list = document.getElementById('videos');
const allow = document.getElementById('allow');
const originInput = document.getElementById('origin');

const ALLOWED_ORIGIN =
  /^(https:\/\/hibikiapp\.net|https:\/\/shadowing\.julianpopovskijones\.workers\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;

const send = (message) =>
  chrome.runtime.sendMessage({ type: 'popup', ...message }).then((response) => {
    if (!response) throw new Error('Hibiki Bridge is restarting. Try again.');
    if (response.error) throw new Error(response.error);
    return response.result;
  });

async function targetTab() {
  // Automated tests open the popup in a tab and name the page's tab explicitly.
  const requested = new URLSearchParams(location.search).get('tab');
  if (requested) return chrome.tabs.get(Number(requested));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Runs inside each frame of the page: describe its videos, largest first.
function describeVideos() {
  return [...document.querySelectorAll('video')]
    .filter((video) => video.isConnected)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
    .map((video, index) => ({
      index,
      width: video.clientWidth,
      height: video.clientHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      tracks: [...video.textTracks].filter((t) => ['subtitles', 'captions'].includes(t.kind))
        .length,
    }));
}

const clock = (seconds) => {
  const s = Math.floor(seconds % 60),
    m = Math.floor(seconds / 60) % 60,
    h = Math.floor(seconds / 3600);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
};

async function render() {
  const tab = await targetTab();
  list.replaceChildren();
  allow.hidden = true;
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
    statusLine.textContent = 'Open a web page with a video, then click Hibiki Bridge.';
    return;
  }
  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: describeVideos,
    });
  } catch {
    statusLine.textContent = 'Hibiki Bridge cannot read this page.';
    return;
  }
  const found = frames
    .flatMap((frame) => (frame.result ?? []).map((video) => ({ ...video, frameId: frame.frameId })))
    .filter((video) => video.duration > 0 || video.width * video.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 5);
  if (!found.length) {
    statusLine.textContent =
      'No video found. If it plays in an embedded player, allow Hibiki Bridge to read embedded players.';
    allow.hidden = false;
    return;
  }
  const status = await send({ action: 'status', tabId: tab.id, pageUrl: tab.url });
  statusLine.textContent = status.waiting
    ? 'Your Hibiki lesson is waiting for this video.'
    : found.length === 1
      ? 'Practise this video with Hibiki.'
      : 'Choose the video to practise.';
  for (const [position, video] of found.entries()) {
    const item = document.createElement('li');
    const details = document.createElement('span');
    details.textContent = [
      found.length > 1 ? `Video ${position + 1}` : 'Video',
      video.duration ? clock(video.duration) : null,
      video.tracks
        ? `${video.tracks} subtitle track${video.tracks > 1 ? 's' : ''}`
        : 'no subtitles',
    ]
      .filter(Boolean)
      .join(' · ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = status.waiting ? 'Connect to my Hibiki lesson' : 'Practise in Hibiki';
    button.addEventListener('click', async () => {
      button.disabled = true;
      statusLine.textContent = status.waiting ? 'Connecting…' : 'Opening Hibiki…';
      try {
        await send({
          action: status.waiting ? 'attach' : 'import',
          tabId: tab.id,
          frameId: video.frameId,
          videoIndex: video.index,
          pageUrl: tab.url,
          title: tab.title,
        });
        statusLine.textContent = status.waiting ? 'Connected.' : 'Opened in Hibiki.';
        if (!new URLSearchParams(location.search).get('tab')) window.close();
      } catch (error) {
        statusLine.textContent = error.message;
        button.disabled = false;
      }
    });
    item.append(details, button);
    list.append(item);
  }
}

allow.addEventListener('click', async () => {
  if (await chrome.permissions.request({ origins: ['<all_urls>'] })) await render();
});

void chrome.storage.local.get('origin').then(({ origin }) => {
  originInput.value = origin || 'https://hibikiapp.net';
});
originInput.addEventListener('change', async () => {
  const value = originInput.value.trim().replace(/\/+$/, '');
  if (!ALLOWED_ORIGIN.test(value)) {
    originInput.setCustomValidity('Use the Hibiki site or a localhost address.');
    originInput.reportValidity();
    return;
  }
  originInput.setCustomValidity('');
  await send({ action: 'origin', origin: value });
});

render().catch((error) => {
  statusLine.textContent = error.message;
});
