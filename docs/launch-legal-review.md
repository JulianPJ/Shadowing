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
- [x] Operator supplied a London business address, authorised its publication, and confirmed it can receive official business/legal correspondence. Independently confirm it meets relevant geographic establishment and other legal-notice requirements before final release.
- [x] Operator supplied a shared public support and privacy email address: hibiki.dev.shadowing@gmail.com, and confirmed the inbox can receive and reply. Independently test support and privacy handling before release.
- [x] No Companies House company registration number is required merely for operating as a sole trader. Do not publish a private UTR, National Insurance number or other tax identifier.
- [x] Operator confirmed **never VAT registered** and **£0 gross self-employment revenue in the previous 12 months**. Public wording: **Not VAT registered**. No mandatory UK VAT registration is indicated on these facts under the current £90,000 threshold, assuming no expected >£90,000 turnover in the next 30 days.
- [ ] Review UK VAT place-of-supply/turnover treatment for the Hibiki-to-Paddle reseller relationship and re-assess if turnover or business establishment changes (including the planned Japan move). This is not a claim that Paddle removes Hibiki's own tax obligations.
- [x] Intended customer market: **worldwide**, wherever service and payments are legally supported; this is product intent, not a finding of global legal compliance.
- [x] Owner's intended age policy: **minors may use the service with appropriate parent/guardian permission**, subject to applicable country-specific requirements.
- [ ] Confirm governing law, specific countries served, and region-specific consumer and privacy requirements. Assess UK/EU representatives and DPO obligations as applicable.
- [ ] **Worldwide minors launch gate:** assess UK Age Appropriate Design Code, UK GDPR, EU GDPR and relevant member-state digital-consent ages, US COPPA and other served markets. Determine required age assurance, verifiable guardian consent, records, content/feature restrictions, deletion and support procedures. A legal notice or guardian permission alone is not a substitute for required technical and operational protections.
- [ ] Audit email registration, Google sign-in, checkout and account processing for under-age access. The current registration UI does not collect an age or verify guardian permission. Prevent minors who require additional legal safeguards from registering or subscribing until compliant controls exist.
- [ ] Resolve remaining VAT placeholder, set approved effective date, and ensure Paddle lists the right business details.

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
