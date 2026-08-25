# Meta messaging on staging

NRMS keeps every Instagram and WhatsApp connection property-scoped. Access
tokens are encrypted by the API and are never returned to the browser.

## Staging environment

Configure these on the staging API service:

```text
META_APP_ID=<Meta app ID used by WhatsApp>
META_APP_SECRET=<Meta app secret used by WhatsApp and webhook signatures>
META_WEBHOOK_VERIFY_TOKEN=<the same private value entered in Meta Webhooks>
META_GRAPH_API_VERSION=v26.0

META_INSTAGRAM_APP_ID=<Instagram app ID shown under Instagram API setup>
META_INSTAGRAM_APP_SECRET=<Instagram app secret shown under Instagram API setup>
META_INSTAGRAM_REDIRECT_URI=https://nolsaf-api-staging.onrender.com/oauth/meta/instagram/callback

META_WHATSAPP_CONFIG_ID=<Embedded Signup configuration ID>
META_OAUTH_STATE_SECRET=<a separate random secret of at least 32 bytes>
ENCRYPTION_KEY=<the existing stable staging encryption key>
WEB_ORIGIN=<the staging web application origin>
```

Do not reuse the webhook verify token as an app secret, OAuth state secret or
encryption key. Changing `ENCRYPTION_KEY` after connections exist makes their
stored access tokens unreadable.

## Meta dashboard

1. Add the exact `META_INSTAGRAM_REDIRECT_URI` to the Instagram OAuth redirect
   allowlist. The staging and production callbacks must be separate entries.
2. Keep the webhook callback set to
   `https://nolsaf-api-staging.onrender.com/webhooks/meta` for staging.
3. Subscribe Instagram to `messages` and, when offered, `messaging_seen`.
4. Create a WhatsApp Embedded Signup configuration and put its configuration
   ID in `META_WHATSAPP_CONFIG_ID`.

After redeploying, open **NRMS → Hotel controls → Guest contact channels** for
the intended property. Use **Connect Instagram** or **Connect WhatsApp** there.
The account selected in Meta is then bound only to that property.

## Data integrity

- Meta webhook retries are deduplicated by provider message ID.
- Concurrent first messages from one sender share one active inquiry.
- Resolving, closing or converting an inquiry releases that active identity so
  a later guest conversation can open a fresh inquiry.
- A public hold retry returns the original reservation and payment capability;
  it does not consume another room.
- Meta inquiries do not block inventory. Only the resulting `HELD` or
  `CONFIRMED` reservation is projected into availability and the NRMS calendar.
