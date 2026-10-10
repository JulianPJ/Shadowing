# Hibiki Bridge

Practise any web page's video in Hibiki. Click the extension on a page with a video and choose **Practise in Hibiki**. Hibiki uses the page's Japanese subtitles, or your own, or (Pro) Whisper subtitles made while the video plays.

Install for development: `chrome://extensions` → Developer mode → **Load unpacked** → this folder. Behaviour, permissions and limits: [docs/browser-extension.md](../docs/browser-extension.md).

Store release: `python3 scripts/package-extension.py` generates `dist/hibiki-bridge-0.1.0.zip` with the manifest at its ZIP root. See [Chrome Web Store release instructions](../docs/chrome-web-store.md).
