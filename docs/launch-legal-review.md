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

Footer links, registration references, the 18+ eligibility confirmation and subscription modal disclosures are included.

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
- [x] ~~Owner's earlier intended age policy: minors may use the service with parent/guardian permission.~~ **Superseded** by the initial 18+ account and subscription policy below.
- [ ] Confirm governing law, specific countries served, and region-specific consumer and privacy requirements. Assess UK/EU representatives and DPO obligations as applicable.
- [ ] Confirm with a qualified adviser that self-declared 18+ eligibility (below) is a proportionate initial control for each served market, or whether stronger age assurance is required anywhere.

## 18+ eligibility policy (initial implementation)

**What it is:** a *self-declared* eligibility check. Hibiki asks the learner to confirm they are 18 or older and stores only the time of that confirmation (`user.adultSelfDeclaredAt`). **It is not age verification or age assurance**: no date of birth, ID document, age estimation or third-party check is used, and a learner who ticks the box falsely is not detected. It does not by itself establish compliance with any law.

Implemented:

- [x] Email registration requires `adultConfirmed: true`; the server refuses the request otherwise (Better Auth `before` hook) and a `user.create.before` database hook refuses any user row created without a recorded confirmation.
- [x] Google sign-in cannot create accounts implicitly (`disableImplicitSignUp`). Google sign-up is only possible from registration with `requestSignUp` plus the confirmation; the confirmation is carried in server-trusted OAuth state, not client `additionalData`.
- [x] The stored timestamp is server-owned (`input: false`); request bodies and Google profiles cannot set it.
- [x] Checkout (`POST /api/billing/checkout`) and opening a pending checkout require the confirmation server-side. Paddle only grants Pro through server-created checkout intents, so client-side Paddle checkouts cannot bypass it. The billing portal stays available so existing subscribers can cancel.
- [x] Existing accounts (migration `0017` leaves them unconfirmed) keep all data. Until confirmed, account APIs (sync, vocabulary, review, word states, Watch Later/Discover) and Pro routes return `adult-confirmation-required`; `/api/account/me`, personal data export, the confirmation endpoint, billing status/portal and sign-out remain available. The app shows a confirmation prompt with an "I am under 18 — sign out" option. Nothing is deleted automatically.
- [x] Terms, Privacy Policy, refunds notice, registration and subscription messaging updated; all state that the check is self-declared.

Before release:

- [ ] Run `npm run db:migrate:production` for `0017_adult_self_declaration.sql` as part of the normal deploy (it only adds a nullable column) and confirm existing users see the prompt rather than losing data.
- [ ] Decide whether signed-out use (no account) is offered to under-18s. The UK Age Appropriate Design Code and similar laws can apply to services *likely to be accessed* by children regardless of account status; the 18+ policy currently covers accounts and subscriptions only.
- [ ] Define the operational procedure when an under-18 account is reported or self-identified: restriction, deletion timing, refund/cancellation handling with Paddle, and records kept.
- [ ] Decide whether existing subscribers who never confirm should be contacted (renewals continue in Paddle while their account is restricted) and how long unconfirmed accounts are retained.
- [ ] Check whether Paddle's buyer terms/age requirements align with the 18+ policy and whether Paddle should be informed.
- [ ] Re-confirm on material policy changes: the timestamp records *that* a confirmation happened, not which policy version; add a version field if re-confirmation is ever required.
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
