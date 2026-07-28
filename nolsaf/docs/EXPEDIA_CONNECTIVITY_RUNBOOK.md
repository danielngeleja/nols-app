# NRMS Expedia Group lodging-supply runbook

## Fixed API boundary

NRMS integrates Expedia Group as a lodging supplier/connectivity provider. It does not use Expedia Rapid.

- Reservations: Lodging Supply GraphQL Reservation Management.
- Real-time changes: Expedia Notifications (webhooks), followed by GraphQL retrieval.
- Availability, inventory, rates and restrictions: XML Availability and Rates API.
- Connection validation: Lodging Supply GraphQL Property Status/property access.

Product Management, payment-card retrieval, promotions, messaging, reviews, images and legacy Booking Notification are outside this phase.

## Runtime configuration

Property API credentials are entered by an owner or rotated by an administrator. One Expedia API username/password pair is encrypted in `channel_credential_version`. The same pair obtains an in-memory OAuth token and is inserted into an ARI XML message only immediately before transport.

Environment-owned connectivity settings:

- `RUN_EXPEDIA_WORKER=true` enables reservation reconciliation and outbound delivery on the elected worker process.
- `EXPEDIA_ARI_URL` is the environment-specific endpoint assigned by Expedia. NRMS intentionally has no guessed production default.
- `EXPEDIA_NOTIFICATION_API_KEY` must match the API key registered with Expedia's callback configuration.
- `EXPEDIA_NOTIFICATION_SECRET` is the current callback HMAC secret.
- `EXPEDIA_NOTIFICATION_PREVIOUS_SECRET` is accepted only during Expedia's documented secret-rotation overlap.
- `EXPEDIA_TOKEN_URL` and `EXPEDIA_GRAPHQL_URL` are optional test overrides; production defaults point to Expedia Group's documented endpoints.

Callback URL:

`https://<api-host>/webhooks/expedia/reservations`

The callback validates `api-key`, `x-eg-notification-timestamp`, and `x-eg-notification-signature-v2` against the exact request bytes. It rejects stale timestamps and accepts both current and previous secrets during rotation. It stores a data-minimized inbox record and responds before GraphQL or reservation processing begins.

## Activation sequence

1. Expedia accepts NRMS as a connectivity provider and assigns an Integration Specialist or Technical Account Manager.
2. Obtain test credentials, Reservation Management scope, Notifications scope, test properties and the ARI test endpoint.
3. Configure the public callback and save the generated API key/secret in the deployment secret manager.
4. Connect a test property from NRMS and verify GraphQL property access.
5. Map every Expedia room/unit and rate plan to one NRMS room type.
6. Run create, modify and cancel reservation fixtures, including duplicate and out-of-order webhook delivery.
7. Validate ARI inventory, rate, min/max stay, closed-to-arrival, closed-to-departure, stop-sell and release.
8. Run full forward resynchronization and compare Expedia Partner Central with NRMS for every mapped product/date.
9. Complete Expedia certification, then operate a small reconciled pilot before changing trust from `PILOT` to `CERTIFIED`.

## Operational rules

- A webhook is acknowledged only after durable inbox storage; Expedia notification confirmation occurs after the reservation is committed to NRMS.
- GraphQL reconciliation overlaps its cursor by five minutes to recover boundary events.
- GraphQL 200 responses containing errors are failures. Rate-limit and transient failures use bounded exponential retry.
- ARI messages are split at 5,000 updates. Successful responses containing warnings are retained as acknowledged deliveries with open reconciliation issues.
- Until `EXPEDIA_ARI_URL` is supplied, NRMS keeps the Expedia outbound worker and manual ARI synchronization disabled instead of creating false delivery failures or guessing an endpoint.
- Each mapped rate plan can use the NRMS room base rate, a fixed price, a base-rate offset, or a multiplier. Validated non-overlapping date ranges can override price, stop-sell, minimum/maximum stay, closed-to-arrival, and closed-to-departure.
- Expedia-critical reservation, webhook, delivery, owner, and administrator database operations use the generated Prisma client types. New schema or relation mismatches must fail typecheck before deployment.
- Raw provider reservation responses, payment tokens, cards, loyalty identifiers and free-text special requests are never persisted in the channel inbox.
- Stop-sell and inventory release require two different administrators and remain queued until Expedia acknowledges the ARI delivery.
- Production readiness requires certification evidence, a real test property, independent PCI/PII review, alert drills and measured reliability; passing builds is not a launch approval.
