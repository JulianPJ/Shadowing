# Hibiki design exploration

A consistent place for design proposals, mockups and decisions from the Work Mode discussion.

## Stage 01 — visual identity

[Open the visual identity proposal](./01-visual-identity/README.md)

- [Identity presentation board — not a desktop viewport](./01-visual-identity/identity-desktop.png)
- [Light and dark mobile board](./01-visual-identity/identity-mobile-themes.png)
- [Proposed exact tokens](./01-visual-identity/identity-tokens.json)
- [Calculated contrast pairs](./01-visual-identity/contrast.json)

Status: **implemented**, 20 October 2026. Generated images use illustrative content; written specifications correct image drift.

What shipped:

- **Tokens.** The token roles are runtime CSS variables in `base.css` (light), `theme.css` (dark) and the Studio Mode scope in `display-preferences.css`: `--action`, `--on-action`, `--action-hover`, `--accent-text`, `--on-forest`, `--control-border`, `--focus` and `--danger`. `--accent-text` (`#9F4E3B` light) is terracotta for small text, because brand `#B65D48` measured 3.9–4.5:1 against paper and tints. Brand terracotta stays on the wordmark, the hero italic, icons and large numerals.
- **Actions.** Filled buttons, badges, subscription chips and Studio Mode use the action tokens, which means dark labels on terracotta in dark mode. The subscription call-to-action is a flat fill. The subscription hero gradient starts at the action fill, so white text keeps at least 4.5:1.
- **State.** Focus rings are forest in both themes. The current nav item and section tab use forest tint, weight and an underline.
- **Practice player.** Listening uses the terracotta tint, Your turn the forest tint, and Recording a filled action badge plus a filled Stop button. Recording never reuses the calm green treatment. The decorative section-progress bar is hidden from assistive technology; the timestamps carry the information.
- **Readability.** Every grey text colour that failed is now `--muted`. Minimum text size is 12px, or 11px for letter-spaced uppercase labels; furigana is exempt. This replaces 158 declarations as small as 7px, many of them in narrow-width overrides.
- **Accessibility name.** Save for later's accessible name now starts with its visible label.

Verified with a computed-contrast sweep in both themes of Home, Discover, Library, Review, Words, Profile, Pricing, sign-in, register, terms and the demo player. The only remaining flag is the decorative illustration label, which sits on artwork. Screenshots at 1440px and 390px showed no horizontal overflow. Not separately verified: browser 200% zoom, screen-reader flow, and the subscription dialog in a live checkout.

## Stage 02 — clearer separation of destinations

[Open the destination proposal and implementation handoff](./02-destinations/README.md)

- [Revised full-page desktop layouts and rationale](./02-destinations/desktop-revision.md)
- [Desktop Home](./02-destinations/home-desktop.png) · [Desktop Discover](./02-destinations/discover-desktop.png) · [Desktop Library](./02-destinations/library-desktop.png)
- [Original narrow-frame composite — superseded for desktop layout](./02-destinations/destinations-desktop.png)
- [Vocabulary, Profile and mobile navigation concepts](./02-destinations/destinations-mobile.png)

Five proposed destinations: **Home · Discover · Library · Vocabulary · Profile**. Home resumes, Discover finds new content, Library revisits kept content. Existing routes, JLPT bands, Review/Words and Library filter meanings are retained. The guide covers mobile/Practice navigation, aliases, handoffs, empty states and current Free/Pro boundaries.

Status: **accepted**, 20 October 2026. The user chose five destinations over the critique's recommendation to keep three sections. Not yet implemented; follow the implementation handoff in the stage guide. Personalised Home is illustrated only enough to explain destination ownership.

## Next stages

1. Personalised Home — develop the overview and first-use/returning states in more depth.
2. Progress and rewards — factual activity, clear next action, no punitive streak pressure.
3. Practice hierarchy — compare a conservative refinement with a more guided Listen / Speak / Compare approach.
4. Discover — retain JLPT levels and existing browsing strengths.

Record accepted/rejected decisions here as the conversation continues.
