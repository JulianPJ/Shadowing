# Hibiki launch legal policy review — must complete before merging

**Status:** first draft, not legal approval. **Do not merge this PR or activate real-money subscriptions until the owner completes these checks.** The pages are product-specific drafts, not professional legal advice. Verify governing law and served markets with a qualified adviser if appropriate.

## Public routes

- /terms — service terms, accounts, media, AI and third-party content.
- /privacy — personal data, legal bases, processors, retention and rights.
- /refunds — subscriptions, Paddle billing, cancellations and refunds.
- /cookies — authentication cookies and local browser storage.
- /contact — verified trader identity, postal address and contact details.
- /extension-privacy.html — existing extension notice, now linked to the main policies.
- /notices — existing open-source/dictionary attribution; unchanged.

Footer links, registration references and subscription modal disclosures are included.

## Required owner details — never invent

Edit src/lib/legal/operator.ts and remove the draft warning from src/components/legal-shell.tsx before merging:

- [x] Business structure confirmed by operator: **sole trader** (not a limited company).
- [x] Hibiki identified as the trading name.
- [x] Operator-provided full legal name: Julian Popovski-Jones; UK establishment details recorded based on UK sole-trader operation.
- [x] Operator supplied a London business address and explicitly authorised its publication. Confirm ability to use it for legal notices before final release.
- [x] Operator supplied a shared public support and privacy email address: hibiki.dev.shadowing@gmail.com. [ ] Test inbound receipt and response workflow before release.
- [x] No Companies House company registration number is required merely for operating as a sole trader. Do not publish a private UTR, National Insurance number or other tax identifier.
- [ ] VAT registration status and VAT number if registered; confirm the correct public wording.
- [ ] Confirm governing law, primary customer markets and under-age account/consent approach; check whether a DPO or UK/EU representative is needed.
- [ ] Replace all placeholders, set approved effective date, and ensure Paddle lists the right business details.

## Data protection and cookie audit

- [ ] Audit actual deployed providers, data categories, destination countries and agreements: Cloudflare, Resend, Google, Paddle, YouTube/Vimeo, DeepL/MyMemory and other configured providers.
- [ ] Verify UK GDPR lawful bases and any required international-transfer safeguards; describe arrangements correctly in the Privacy Policy.
- [ ] Establish accurate retention periods/criteria for account and learning data, security logs, D1 payments/events, browser caches and backups; confirm data erasure/request procedures.
- [ ] Check account export and manual deletion/rectification support, including cancellation of active subscriptions and legal retention exceptions.
- [ ] Audit cookies, local storage, embedded players, Google auth and Paddle checkout in a clean browser. If non-essential analytics or tracking technology is used, implement and test any required prior consent.
- [ ] Align the Chrome Web Store privacy declaration with extension-privacy.html and /privacy.
- [ ] Check ICO registration/data protection fee applicability: https://ico.org.uk/for-organisations/data-protection-fee/

## Billing/consumer audit

- [ ] Verify Paddle live merchant review and the real catalogue price, currency and period; do not assume sandbox pricing automatically transfers.
- [ ] Verify buyer sees the price inclusive of relevant taxes, recurrence, buyer contract, how to cancel, and confirmation email.
- [ ] Verify cooling-off/withdrawal rules for each market. Determine whether explicit early-performance consent and acknowledgment is required and where Paddle captures it; links alone do not waive statutory rights.
- [ ] Verify customer portal, failed billing, cancellation, refunds and entitlement events; account deletion must not be treated as cancelling a Paddle subscription.
- [ ] Check all policy links, Paddle support URLs and renewal notices before going live.

## Official sources

- UK distance selling: https://www.gov.uk/online-and-distance-selling-for-businesses
- UK online selling: https://www.gov.uk/online-and-distance-selling-for-businesses/online-selling
- UK electronic-commerce disclosure: https://www.legislation.gov.uk/uksi/2002/2013/regulation/6
- ICO privacy information: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/
- ICO cookies: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/
- Paddle buyer terms: https://www.paddle.com/legal/buyer-terms
- Paddle refund policy: https://www.paddle.com/legal/refund-policy
- Paddle buyer support: https://paddle.net/

**Release gate:** keep PR as a draft until all public operator details are supplied, content is reviewed, and applicable policy/consent requirements are confirmed. Passing CI does not establish legal compliance.
