# WhatsApp access-token rotation

How a WhatsApp Cloud API connection's access token is stored and replaced, and a
log of the rotations that have been done. No token, encrypted value, secret or
personal identifier belongs in this file.

## Where the token lives

- Each connection's token is stored only in `whatsapp_connections.access_token`.
  Values written by the manual-attach path are encrypted with AES-256-GCM
  (`SECRETS_ENC_KEY`) behind the `scm1.` prefix
  (`lib/whatsapp/connectionToken.ts`). A value without the prefix is read as
  plaintext.
- No environment variable holds a WhatsApp token.
- Every send reads the token from the row at send time
  (`lib/inbox/whatsappOutboundTarget.ts`). Replacing the stored value takes
  effect on the next send. No deploy or restart is needed.
- Inbound webhooks are verified with `META_APP_SECRET`, not with this token. An
  expired token stops outbound sends only: inbox replies, templates, wedding
  invitations and RSVP requests, automated replies, template sync and media
  download.

## Procedure

This applies only to the single manually attached `cloud_api` connection pinned
by the `MANUAL_ATTACH_*` constants (agency, WABA, phone number, app) in
`lib/whatsapp/attachExistingWaba.ts`. It does not cover Embedded Signup or
Coexistence connections: the path refuses any other agency, WABA, phone number or
`onboarding_type`, and those connections get new tokens by reconnecting. The
application path is `attachExistingWabaForUser`. When the pinned phone is already
attached to the same agency and WABA, it replaces only `access_token`.

1. **Issue the token (operator, in Meta).** Go to Business Settings → Users →
   System users and select the system user that already has the WABA assigned
   with full control. Generate a new token for the same app with
   `whatsapp_business_management` and `whatsapp_business_messaging`, and choose
   the expiry deliberately: Meta offers 60 days or never. Keep the token in a
   password manager. Never put it in chat, a file in the repo, or logs.
2. **Validate without writing.** Run `debug_token` and require: valid, type
   `SYSTEM_USER`, the expected app ID, both WhatsApp permissions, and the
   intended expiry. Then run the same checks as `verifyManualAttachGraph`: the
   WABA is readable, the phone is `CONNECTED` / `CLOUD_API` with the expected
   display number, the phone is on the WABA, and the app is subscribed. Print
   metadata and PASS/FAIL only.
3. **Back up the current value before any write.** Copy the current encrypted
   value to a new file readable only by the owner. Create it with create-only
   semantics, so an existing backup is never overwritten, then confirm the
   file's permissions and contents by reading it back. If any step fails, abort
   before writing to the database.
4. **Prove the key before writing.** The local `SECRETS_ENC_KEY` must decrypt the
   connection's current production value. With AES-GCM, that shows the new value
   will be readable by production. If it does not decrypt, refuse.
5. **Replace the token.** Use `attachExistingWabaForUser`: it re-runs the Graph
   checks, then performs one update of `access_token` only. The update is pinned
   to the row `id`, `phone_number_id`, `agency_id`, `waba_id` and
   `onboarding_type = 'cloud_api'`, and must affect exactly one row. Block the
   insert path.
   - In the application, this path is behind `WA_MANUAL_ATTACH_ENABLED` and the
     internal route `POST /api/internal/whatsapp/attach`. Using it means an
     environment change plus a redeploy to turn the switch on, and the same again
     to turn it off.
   - From an operator script, inject the dependencies instead. `@/config/db`
     loads `.env.local`, so a script that writes to production must use its own
     database client and must not rely on the default dependencies.
6. **Verify after the write.**
   - The stored value decrypts to the new token, and `debug_token` passes on it.
   - Restore the backup automatically if the stored value does not match or the
     check fails.
   - The WhatsApp health check (`resolveWhatsappHealth`) reports `operational`.
   - One approved production send is delivered. Use a plain-text reply inside
     the 24-hour window, never a Marketing template.
7. **Close out.** Record the rotation below. The old token keeps working until
   its own expiry unless it is revoked; revocation is a separate, approved step.
   The backup may be deleted only with operator approval after the rollback
   window (the old token's expiry) has passed.

## Rotation log

### 2026-10-10: agency 103

- **Connection:** agency 103's manually attached `cloud_api` connection, the
  only one the manual-attach path accepts. Its WABA, phone number and app are
  pinned by the `MANUAL_ATTACH_*` constants in
  `lib/whatsapp/attachExistingWaba.ts`, so identifiers are not repeated here. On
  2026-10-10, exactly one production `whatsapp_connections` row matched them. The
  Preview database is a copy of production, so it may hold a matching row too;
  this rotation changed production only.
- **Why:** the token was a 60-day system-user token issued 2026-09-01, set to
  expire 2026-10-31 12:41 UTC. The expiry was fixed when the token was
  generated; nothing in the code sets it.
- **New token:** same system user and app, issued 2026-10-10 14:34:13 UTC,
  never expires. Both WhatsApp permissions confirmed.
- **Pre-write validation:** `debug_token` and the full Graph check passed. The
  local key decrypted the current production value.
- **Write:** exactly one row updated. Afterwards, the other connection rows had
  unchanged identity and contained neither the old nor the new token.
- **Post-write verification:**
  - The stored value decrypts to the new token, and `debug_token` passes.
  - The health check reports `operational` (inbound ready, outbound ready).
  - A plain-text production inbox reply to an approved internal test recipient
    was accepted by Meta and reached `delivered`, with no send error.
- **Deployment:** none required. No environment-variable or code change.
- **Old token:** not revoked. It expires 2026-10-31 12:41 UTC.
- **Rollback:** an encrypted backup of the previous value is held locally by the
  operator. It can restore the old token only until 2026-10-31. Deleting it
  requires operator approval after that date.
- **`META_CAPI_ACCESS_TOKEN`: inconclusive.** Vercel metadata shows the variable
  was last updated 2026-07-30, before the old token was issued, and the old token
  carried only WhatsApp permissions. That makes it unlikely that the variable
  held the old token, but it is not proof of value identity. No value or
  fingerprint comparison was done, because the variable is sensitive and
  unreadable. Settle this before revoking the old token early.

## Security follow-up: `SECRETS_ENC_KEY`

Open and not started. It needs an investigation, an impact assessment, and an
approved rotation plan before anything changes.

- **Shared key.** The production `SECRETS_ENC_KEY` (Production and Preview,
  created 2026-05-24, never rotated) has the same value as the key in local
  development `.env.local` files. This was proven when a local process
  decrypted a production-stored value. Anyone with a developer environment file
  and production database access can read every encrypted credential. A token
  that never expires (above) raises the stakes.
- **Preview database.** The Preview/Development database (`preview-shared`) is a
  copy of production data, so it holds values encrypted with the production key.
  A separate Preview-scoped `SECRETS_ENC_KEY` has existed since 2026-09-16.
  Whether its value differs from production's has not been verified. Either way,
  access to the Preview database plus the production key exposes production
  credentials.
- **Values to re-encrypt on rotation.** Everything written through
  `encryptSecret` (`lib/crypto/secrets.ts`):
  - WhatsApp connection tokens (`scm1.`, `lib/whatsapp/connectionToken.ts`).
  - Facebook Page and Ads tokens (`scm1.`, `lib/facebook/pageToken.ts`,
    `db/facebookAds.ts`).
  - Google Calendar and Google Drive access and refresh tokens
    (`lib/integrations/google/*Tokens.ts`).
  - Payment provider tokens: card tokens, setup-process and setup-transaction
    tokens, and charge transaction tokens (`db/payments/*`).
  - Short-lived Facebook pending-pages cookie envelopes
    (`lib/facebook/pendingPages.ts`). These expire on their own, but in-flight
    ones break at cutover.
  The rotation needs a re-encryption step (decrypt with the old key, encrypt with
  the new one) or a dual-key read window. Production, Preview and local must end
  up with separate keys.
- **Unencrypted tokens.** On 2026-10-10, five `whatsapp_connections` rows stored
  their tokens as plaintext. All are Embedded Signup or Coexistence connections;
  the reader accepts both formats by design. Legacy `facebook_pages` rows may
  also be plaintext until their Page is reconnected. Decide whether to encrypt
  them as part of the same plan.
