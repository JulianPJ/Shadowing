// Injected only into the frame holding the video the learner chose in the popup. It plays,
// pauses and seeks that video for Hibiki, reads its subtitle tracks, shows Hibiki's current
// line over it, and can capture its audio for Whisper subtitles.
(() => {
  if (window.__hibikiController) return;
  window.__hibikiController = true;

  const RATE = 16000;
  let video = null;
  let port = null;
  let lastState = 0;
  let overlay = null;
  let capture = null;

  function post(event, data) {
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: 'hibiki-controller' });
        port.onDisconnect.addListener(() => {
          port = null;
        });
      }
      port.postMessage({ type: 'event', event, data });
    } catch {
      port = null;
    }
  }

  function videos() {
    return [...document.querySelectorAll('video')]
      .filter((v) => v.isConnected)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  }
  const state = () => ({
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused,
    ended: video.ended,
    playbackRate: video.playbackRate,
  });
  function report(force) {
    const now = performance.now();
    if (!force && now - lastState < 240) return;
    lastState = now;
    post('media-state', state());
  }

  const stripTags = (text) =>
    text
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  async function readTracks() {
    const tracks = [];
    for (const track of [...video.textTracks].slice(0, 20)) {
      if (!['subtitles', 'captions'].includes(track.kind)) continue;
      const mode = track.mode;
      if (mode === 'disabled') track.mode = 'hidden';
      for (let waited = 0; !(track.cues && track.cues.length) && waited < 3000; waited += 100)
        await new Promise((resolve) => setTimeout(resolve, 100));
      const cues = [...(track.cues ?? [])]
        .slice(0, 15000)
        .map((cue) => ({ start: cue.startTime, end: cue.endTime, text: stripTags(cue.text ?? '') }))
        .filter((cue) => cue.text && cue.end > cue.start);
      track.mode = mode;
      if (cues.length) tracks.push({ label: track.label, language: track.language, cues });
    }
    return tracks;
  }

  // Hibiki's current line, drawn over the original video (including in fullscreen).
  function showSubtitle(text) {
    if (!text) {
      overlay?.remove();
      overlay = null;
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, {
        position: 'fixed',
        zIndex: '2147483647',
        transform: 'translateX(-50%)',
        maxWidth: '90vw',
        padding: '6px 16px',
        borderRadius: '6px',
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        font: '600 clamp(18px, 2.3vw, 34px)/1.5 system-ui, sans-serif',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      const place = () => {
        if (!overlay || !video) return;
        const host = document.fullscreenElement ?? document.body;
        if (overlay.parentNode !== host) host.append(overlay);
        const box = video.getBoundingClientRect();
        overlay.style.left = `${box.left + box.width / 2}px`;
        overlay.style.top = `${box.bottom - Math.max(64, box.height * 0.12)}px`;
        overlay.style.transform = 'translate(-50%, -100%)';
        requestAnimationFrame(place);
      };
      requestAnimationFrame(place);
    }
    overlay.textContent = text;
  }

  // --- Audio capture: 16 kHz mono PCM placed by media time, emitted as WAV windows. ---
  function wave(pcm) {
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, RATE, true);
    view.setUint32(28, RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    new Int16Array(buffer, 44).set(pcm);
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function emit(slot, written) {
    const buffer = capture.buffers.get(slot.index);
    capture.buffers.delete(slot.index);
    capture.done.add(slot.index);
    if (!buffer) return;
    // A window cut short by "finish now" or the video's end keeps only what was heard.
    const samples = buffer.subarray(0, Math.max(0, Math.min(buffer.length, written)));
    if (samples.length < RATE / 2) return;
    post('capture-chunk', {
      index: slot.index,
      start: slot.start,
      end: slot.start + samples.length / RATE,
      audio: wave(samples),
    });
  }
  function write(samples, at) {
    capture.reach = Math.max(capture.reach, at + samples.length);
    for (const slot of capture.windows) {
      if (capture.done.has(slot.index)) continue;
      const first = Math.round(slot.start * RATE),
        last = Math.round(slot.end * RATE);
      if (at + samples.length <= first || at >= last) continue;
      let buffer = capture.buffers.get(slot.index);
      if (!buffer) capture.buffers.set(slot.index, (buffer = new Int16Array(last - first)));
      for (let i = Math.max(0, first - at); i < samples.length && at + i < last; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        buffer[at + i - first] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
    }
    for (const slot of capture.windows)
      if (!capture.done.has(slot.index) && at + samples.length >= Math.round(slot.end * RATE))
        emit(slot, Math.round((slot.end - slot.start) * RATE));
  }
  function finishCapture(reason) {
    if (!capture) return;
    // Measured by the furthest audio heard: playback has already paused when the video ends.
    const { context, stream, reach } = capture;
    for (const slot of capture.windows)
      if (!capture.done.has(slot.index)) emit(slot, reach - Math.round(slot.start * RATE));
    capture = null;
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    post('capture-end', { reason });
  }
  async function startCapture(windows) {
    if (capture) finishCapture('stopped');
    let stream;
    try {
      stream = video.captureStream();
    } catch {
      throw new Error(
        "This site doesn't let its audio be captured. Download the audio and use “Import media or subtitles” instead.",
      );
    }
    if (!stream.getAudioTracks().length)
      throw new Error('This video has no audio track to capture.');
    const context = new AudioContext();
    await context.resume().catch(() => {});
    if (context.state !== 'running') {
      void context.close();
      throw new Error('Click the video page once, then start subtitles again.');
    }
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const ratio = context.sampleRate / RATE;
    capture = {
      windows,
      buffers: new Map(),
      done: new Set(),
      cursor: null,
      reach: 0,
      context,
      stream,
    };
    processor.onaudioprocess = (event) => {
      if (!capture) return;
      // Only audio heard during normal-speed playback maps onto the media timeline.
      if (video.paused || video.seeking || video.readyState < 3) {
        capture.cursor = null;
        return;
      }
      if (video.playbackRate !== 1) video.playbackRate = 1;
      const input = event.inputBuffer.getChannelData(0);
      // Average the source samples folding into each 16 kHz sample (a simple low-pass). The
      // sub-sample remainder per block is negligible; the media-time resync below absorbs it.
      const count = Math.floor(input.length / ratio);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const from = Math.floor(i * ratio),
          to = Math.min(input.length, Math.ceil((i + 1) * ratio));
        let sum = 0;
        for (let j = from; j < to; j++) sum += input[j];
        samples[i] = to > from ? sum / (to - from) : 0;
      }
      const expected = Math.round(video.currentTime * RATE) - count;
      const at =
        capture.cursor === null || Math.abs(capture.cursor - expected) > 0.3 * RATE
          ? expected
          : capture.cursor;
      write(samples, Math.max(0, at));
      capture.cursor = Math.max(0, at) + count;
    };
    source.connect(processor);
    processor.connect(context.destination);
    video.playbackRate = 1;
    video.currentTime = windows[0]?.start ?? 0;
    await video.play();
    return true;
  }

  const actions = {
    select: async (index) => {
      const chosen = videos()[index];
      if (!chosen) throw new Error('That video is no longer on the page.');
      const fresh = chosen !== video;
      video = chosen;
      if (fresh)
        for (const type of ['play', 'pause', 'ended', 'seeked', 'ratechange', 'durationchange'])
          video.addEventListener(type, () => report(true));
      if (fresh) {
        video.addEventListener('timeupdate', () => report(false));
        video.addEventListener('ended', () => finishCapture('ended'));
      }
      return {
        title: document.title,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        tracks: await readTracks(),
      };
    },
    state: async () => state(),
    play: async () => {
      await video.play();
      return state();
    },
    pause: async () => {
      video.pause();
      return state();
    },
    seek: async (time) => {
      video.currentTime = Math.max(0, Number(time) || 0);
      return state();
    },
    rate: async (value) => {
      if (!capture) video.playbackRate = Number(value) || 1;
      return state();
    },
    subtitle: async (text) => {
      showSubtitle(typeof text === 'string' ? text.slice(0, 500) : '');
      return true;
    },
    'capture-start': (windows) => startCapture(Array.isArray(windows) ? windows : []),
    'capture-stop': async () => {
      finishCapture('stopped');
      return true;
    },
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'command') return;
    const action = actions[message.action];
    if (!action || (!video && message.action !== 'select')) {
      sendResponse({ error: 'Hibiki Bridge lost this video. Connect it again from the popup.' });
      return;
    }
    action(message.value).then(
      (result) => sendResponse({ result }),
      (error) =>
        sendResponse({
          error:
            error?.name === 'NotAllowedError'
              ? 'The video page needs a click before it can play. Click it once, then try again.'
              : error?.message || 'The video page could not do that.',
        }),
    );
    return true;
  });
})();
