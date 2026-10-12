# Paddle Billing

Hibiki uses Paddle Billing as merchant of record, with a Paddle-hosted overlay for monthly and annual Pro and Paddle's hosted customer portal for invoices, payment details and cancellation. This implementation defaults to **sandbox, disabled**. No production deployment or activation is included.

## Configuration

These are Worker bindings in `cloudflare.config.ts`. Local overrides belong in an ignored `.dev.vars` file used by the Cloudflare Vite plugin. Do not put billing secrets in `NEXT_PUBLIC_*`, browser storage, source control or checkout URLs.

| Binding                       | Purpose                                                          | Default          |
| ----------------------------- | ---------------------------------------------------------------- | ---------------- |
| `PADDLE_ENVIRONMENT`          | `sandbox` or `live`; invalid values fail closed                  | `sandbox`        |
| `PADDLE_ENABLED`              | Enables new checkout after all settings are present              | `false`          |
| `PADDLE_API_KEY`              | Secret: environment-specific Paddle API key                      | unset            |
| `PADDLE_WEBHOOK_SECRET`       | Secret: notification destination's signing secret                | unset            |
| `PADDLE_CLIENT_TOKEN`         | Public Paddle.js token, `test_*` for sandbox / `live_*` for live | empty            |
| `PADDLE_PRO_MONTHLY_PRICE_ID` | Recurring monthly `pri_*` ID                                     | empty            |
| `PADDLE_PRO_ANNUAL_PRICE_ID`  | Recurring annual `pri_*` ID                                      | empty            |
| `AUTH_BASE_URL`               | Canonical origin shared with Better Auth                         | existing origin  |
| `HIBIKI_DB`                   | Existing native D1 binding; apply additive migration `0016`      | existing binding |
| `BILLING_RATE_LIMIT`          | Native fail-closed limit, 10 requests/client/minute              | configured       |

Price IDs are configurable placeholders. Product IDs are not needed by the integration: each price belongs to the Hibiki Pro product in Paddle. Never reuse sandbox IDs or credentials for live. Only the public client token, transaction ID and environment are sent to Paddle.js; API keys and signing secrets remain server-side.

## Sandbox setup checklist

1. Open a Paddle **sandbox** account. Create Hibiki Pro with two **automatically collected, recurring, quantity-one** prices: monthly and annual, frequency 1, without a trial. Choose amounts and currency in Paddle; the app shows the final total and renewal terms in checkout.
2. Create an API key with `transaction.read`, `transaction.write` and `customer_portal_session.write` permissions, plus a sandbox client-side token. Store the API key and webhook secret as Worker secrets using the Cloudflare dashboard or the repository's cf CLI; set the token and two `pri_*` bindings. See [Paddle authentication](https://developer.paddle.com/api-reference/about/authentication/).
3. Use a separate local/staging Worker and D1 database with its own Better Auth origin/secrets. Apply migrations to that database before running the new code. Do not point sandbox verification at the production database. No remote migration has been run by this change.
4. Set Paddle's default payment URL to `<AUTH_BASE_URL>/profile`, with the checkout domain configured in Paddle. A payment link's `_ptxn` query parameter is checked against the signed-in account's server-created transaction before opening the overlay. Sandbox needs no live-domain approval. See [payment links](https://developer.paddle.com/build/transactions/pass-transaction-checkout/).
5. Create a notification destination at `<AUTH_BASE_URL>/api/billing/webhook` for **all `subscription.*` events**, `adjustment.created` and `adjustment.updated`. Optional `transaction.*` notifications are accepted and deduplicated but never grant access. Copy this destination's signing secret into `PADDLE_WEBHOOK_SECRET`. Select sandbox notifications, not live/simulation-only deliveries. See [notifications](https://developer.paddle.com/webhooks/overview/).
6. Set `PADDLE_ENABLED=true` in the sandbox environment. Sign in with a verified test learner. Exercise both prices with [Paddle test cards](https://developer.paddle.com/concepts/payment-methods/test-payment-details/), then verify the delivered webhook and server account plan. Checkout completion alone must leave Free access until a valid subscription event commits.
7. Test renewal, scheduled and immediate cancellation, failed payment (`past_due`), recovery, pause, full/partial refund, duplicate delivery and an older replay. Test **Manage billing** for invoice download, payment-method update and cancellation. Confirm manually enabled Pro and both existing Free/Pro QA accounts keep their plans. Inspect notification delivery failures and retry them after correcting configuration.

Local development: set the bindings in `.dev.vars`, apply local migrations, and run `npm run dev`. Paddle needs a publicly reachable HTTPS webhook URL; use a staging Worker or a development tunnel with the same canonical origin as Better Auth. The built-worker test harness mocks Paddle and never contacts real billing services.

## Authorization and entitlement behavior

| Route                        | Rules                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/billing`           | Better Auth session and mandatory `X-Hibiki-Account`; own subscription summaries only                                     |
| `POST /api/billing/checkout` | Same-origin JSON, verified session, account header; accepts only `{ "interval": "monthly" }` or `annual`                  |
| `POST /api/billing/portal`   | Same authorization; body `{}`; customer resolved from D1, temporary portal URL returned without caching                   |
| `POST /api/billing/webhook`  | Raw body, bounded to 256 KiB; timestamped HMAC-SHA256 signature with five-second tolerance; independent of cookies/origin |

All API routes are dynamic and `no-store`. Browser billing operations share a separate fail-closed quota. A checkout reservation prevents concurrent duplicate transactions, reuses its transaction for 30 minutes and refuses a second subscription while an existing subscription is not canceled. If a provider call fails after reservation, wait for its 30-minute expiry before creating another checkout; confirm transaction state in Paddle before retrying.

New subscriptions require a persisted checkout intent **and** an API lookup confirming that our server-created transaction belongs to that subscription and customer. User IDs in client-supplied custom data are insufficient. Customers and subscription ownership are immutable, scoped by environment, and linked to Better Auth `user.id`. A not-yet-linked Paddle transaction returns retryable 503 so early subscription notifications can be redelivered.

Event deduplication, conditional subscription/adjustment updates and the entitlement projection commit in **one D1 batch**. Each batch has a unique processing token. Concurrent duplicates cannot apply a second mutation; failures roll back the ledger too. Paddle `occurred_at` is normalized to UTC with microsecond precision and older snapshots cannot overwrite newer state. At equal timestamps the more restrictive subscription state or approved revocation wins. Canceled subscriptions cannot be reactivated; a new subscription ID is required. Unsupported or malformed states/prices/periods return 422 and never grant access. No payloads, customer data or credentials are logged.

`user_access.plan` and its manual/test provenance are never overwritten by billing. Separate `paddle_sandbox_until` / `paddle_live_until` fields hold the latest eligible paid expiry. The existing **single-row** account/access query checks the configured environment's paid expiry or the existing manual/test Pro plan. There is no subscription-table read on the player/Pro feature path and no entitlement in browser storage is trusted by the server.

| State/event                               | Paid Pro behavior                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Active subscription / renewal             | Through the verified current billing period                                           |
| Scheduled cancel / pause                  | Through the earlier of effective date and period end                                  |
| Immediate cancel / pause                  | Removed when notification commits                                                     |
| Past due / failed renewal                 | `subscription.past_due` removes paid access; no unpaid grace period                   |
| Payment recovery                          | A newer active snapshot restores access                                               |
| Trialing                                  | No paid access; trials are not offered                                                |
| Missing renewal webhook / expiry          | Stops automatically at paid expiry on the existing access lookup                      |
| Approved full refund / chargeback         | Revokes the refunded paid period, including before activation arrives                 |
| Partial / pending / rejected refund       | Retains access; a partial refund does not represent cancellation                      |
| Refund for an older period                | Does not remove a later renewed paid period                                           |
| Adjustment reversed                       | Newer reversed adjustment restores period eligibility if subscription is still active |
| Browser success / `transaction.completed` | No entitlement change                                                                 |

Refunds use an authenticated transaction lookup for the original billing period rather than the notification arrival time. Subscription updates cannot undo a current-period refund. The UI refreshes the server account after checkout and offers **Refresh plan** while webhook confirmation is pending; returning from the portal reloads billing state. Manual Pro is independent of subscription refunds or expiry.

## Verification and release

Run Node 24, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`, `npm run build`, `npm run test:d1:migrations`, `npm run test:d1:runtime`, then browser tests against `npm run start:test`. `tests/billing.test.ts` uses real Better Auth sessions and local workerd/D1 with mocked Paddle; browser tests cover the Profile actions with Paddle.js mocked.

For a later approved release, apply migration `0016` **before** deploying code. Review sandbox results, plan amounts, tax/product configuration, refund policy, terms/privacy and Paddle domain approval before deciding to activate live billing. Live activation requires a separate explicit approval, `PADDLE_ENVIRONMENT=live`, live IDs/credentials and a live notification destination. Keep checkout disabled during that configuration change. Verify existing manual/test access still works. To stop new sales, set `PADDLE_ENABLED=false`; the portal remains available with the environment's API key, while subscription webhooks and already-paid access continue. Do not delete customer or event records to roll back the UI.

Paddle references: [signature verification](https://developer.paddle.com/webhooks/about/signature-verification/), [transaction checkout](https://developer.paddle.com/api-reference/transactions/create-transaction/), [portal sessions](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/), [subscription events](https://developer.paddle.com/webhooks/subscriptions/subscription-activated/), [refund adjustments](https://developer.paddle.com/webhooks/adjustments/adjustment-updated/).
