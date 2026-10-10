# Hibiki Bridge — Chrome Web Store release

Hibiki Bridge is a Manifest V3 Chrome 116+ companion extension to https://hibikiapp.net. Initial version: `0.1.0`.

## Build the store upload ZIP

```bash
python3 scripts/package-extension.py
# dist/hibiki-bridge-0.1.0.zip
```

The ZIP contains only the seven packaged runtime files and four PNG icons; `manifest.json` is at its root, not inside an enclosing directory. No build source, secrets, npm dependencies or demo fixtures are included. The GitHub Actions workflow **Chrome extension package** validates the ZIP and uploads it as a downloadable artifact.

## Chrome Web Store listing fields

**Name:** Hibiki Bridge

**Category:** Education

**Language:** English

**Short description:** Practise Japanese shadowing with videos on other sites using page subtitles or optional AI transcription.

**Detailed description:**

Hibiki Bridge connects videos on other websites to Hibiki, a Japanese listening and speaking practice app.

Choose a video on a web page, click Hibiki Bridge and select “Practise in Hibiki.” Hibiki reads subtitle tracks exposed by the video page and turns available Japanese captions into short shadowing sections. Listen, pause, repeat and revisit each sentence in context.

- Control the selected video's playback from Hibiki while the video stays on its original website.
- Display Hibiki's current Japanese line over the original video.
- Import your own subtitles when a suitable Japanese track is unavailable.
- Optionally generate Japanese subtitles from supported video audio using Hibiki's transcription service (Pro account required).
- Reconnect a saved lesson by opening the original page and clicking the extension.

Works with compatible HTML5 video elements. Embedded players may need optional website access. Capturing video audio is subject to the original site's technical restrictions. DRM-protected and capture-blocked videos cannot be transcribed. Hibiki Bridge is not a video downloader.

**Website:** https://hibikiapp.net/

**Extension privacy page:** https://hibikiapp.net/extension-privacy.html

**Support:** https://github.com/JulianPJ/Shadowing/issues

**Subscription disclosure:** Hibiki has optional Pro features including AI transcription. Verify current pricing and disclose any paid functionality accurately when required by the dashboard.

## Chrome Web Store privacy disclosures

**Single purpose:** Connect a learner-selected webpage video to Hibiki for Japanese shadowing using playback control, readable subtitle tracks and optional user-initiated audio transcription.

**activeTab:** Grants temporary access only to the page where the learner invokes the extension to locate and control a selected video.

**scripting:** Loads the packaged controller code into the selected page/frame to read media and subtitle tracks, synchronise playback and draw the selected subtitle line over the video.

**storage:** Stores the user's chosen Hibiki origin locally and transient connection state (selected tab IDs, URLs and hand-off metadata) in session storage.

**Optional `<all_urls>`:** When the learner chooses “Allow embedded players,” the extension requests broad optional host access to inspect cross-origin iframe videos. It is never requested automatically during installation.

**Content script origins:** The production Hibiki site, the legacy production workers.dev origin and localhost development environments. The site bridge doesn't run on other ordinary websites; video controllers are injected only on demand.

**Remote code:** No externally hosted script is executed by the extension; all extension JavaScript ships within the ZIP. The separate Hibiki website runs its own application code.

**Data handling:** Page URL/title, selected video playback state, publicly exposed page subtitle cues and optionally user-selected audio are relayed to the Hibiki website. If the user explicitly chooses AI subtitle generation, captured audio goes through the Hibiki website to the Cloudflare-backed Hibiki transcription endpoint. Signed-in Hibiki accounts may separately sync learning metadata.

Choose the exact Google data-disclosure categories based on the language of the latest dashboard fields; do not tick “collects no user data” without considering video page URLs, website content, subtitle cues and optional audio. Confirm the privacy page matches the final release.

## Submission checklist

1. Sign in/register at https://chrome.google.com/webstore/devconsole; pay the one-time Google developer registration fee and complete publisher identity/contact verification, if not done. Choose an email that is actively monitored.
2. Review and publish the extension-specific privacy page at https://hibikiapp.net/extension-privacy.html, and verify it loads publicly. This draft needs owner legal/privacy review.
3. Download the **Chrome extension package** workflow artifact from GitHub Actions. Upload its ZIP as a new extension in the developer dashboard.
4. Supply the icon already in the ZIP, a branded **440×280 px** small promotional tile and at least one **genuine** 1280×800 (or 640×400) screenshot of the actual extension in use. Capture from real Chrome usage on a video the publisher may demonstrate. Do not upload a fabricated UI screenshot.
5. Paste the listing details above and fill in support contact, website, category and permission justifications. Accurately disclose any paid features and all handled data categories.
6. Use Unlisted initially if you want a limited smoke test (Unlisted still undergoes review), then switch to Public after testing. Alternatively submit for Public and choose deferred publishing until approval and smoke verification.
7. Submit for review and respond to Google requests. The initial developer account, agreement, fee and submission are owner-owned Google account actions; GitHub and Cloudflare cannot publish the listing.

## Release checks

- [ ] ZIP validates, includes manifest at root and exactly the allowlisted runtime files.
- [ ] Required 16/32/48/128 PNG icons present at declared paths.
- [ ] Chrome 116+ user-installed extension can import an HTML5 video with Japanese `<track>` captions.
- [ ] Playback pause/seek, over-video subtitles and fullscreen overlay work.
- [ ] Missing captions present upload/paste versus **optional** AI generation.
- [ ] Cross-origin iframe permission request works only on click, including decline.
- [ ] Privacy policy site URL available, reviewed, and consistent with the final dashboard answers.
- [ ] One real 1280×800 screenshot, 440×280 promo tile and contact details are supplied.
- [ ] Developer-account owner has completed Google's dashboard actions.

Google references: https://developer.chrome.com/docs/webstore/prepare , https://developer.chrome.com/docs/webstore/images , https://developer.chrome.com/docs/webstore/cws-dashboard-privacy , https://developer.chrome.com/docs/webstore/program-policies/policies .
