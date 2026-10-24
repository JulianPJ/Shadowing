# Hibiki Bridge

Practise YouTube videos and other web page videos in Hibiki. YouTube watch pages offer a single video and use Hibiki's existing Japanese-caption importer. For other websites, click the extension on a page with a video and choose **Practise in Hibiki**. Hibiki uses the page's Japanese subtitles, or your own, or (Pro) Whisper subtitles made while the video plays.

Install for development: `chrome://extensions` → Developer mode → **Load unpacked** → this folder. Behaviour, permissions and limits: [docs/browser-extension.md](../docs/browser-extension.md).

Store release: `python3 scripts/package-extension.py` generates `dist/hibiki-bridge-0.2.0.zip` with the manifest at its ZIP root. See [Chrome Web Store release instructions](../docs/chrome-web-store.md).
