# WhatsApp access-token rotation

How a WhatsApp Cloud API connection's access token is stored and replaced, and a
log of the rotations that have been done. No token, encrypted value, secret or
personal identifier belongs in this file.

## Where the token lives

- Each connection's token is stored only in `whatsapp_connections.access_token`.
  Values written by the manual-attach path are encrypted with AES-256-GCM
  (`SECRETS_ENC_KEY`, `lib/crypto/secrets.ts`) behind the `scm1.` prefix
  (`lib/whatsapp/connectionToken.ts`). A value without the prefix is read as
  plaintext.
- No environment variable holds a WhatsApp token.
- Code that uses the token reads it from the row when it runs; for sends, see
  `lib/inbox/whatsappOutboundTarget.ts`. Replacing the stored value takes effect
  on the next use. No deploy or restart is needed.
- Inbound webhooks are verified with `META_APP_SECRET`, not with this token, so
  they keep arriving if the token expires. An expired token breaks everything
  that calls Meta with it:
  - outbound sends: inbox replies, templates, wedding invitations and RSVP
    requests, automated replies;
  - template management: create, discard and sync;
  - the WhatsApp health check;
  - inbound media download.

## Procedure

This applies only to the single manually attached `cloud_api` connection pinned
by the `MANUAL_ATTACH_*` constants (agency, WABA, phone number, app) in
`lib/whatsapp/attachExistingWaba.ts`. It does not cover other WhatsApp
connections, such as Embedded Signup or Coexistence: the path refuses any other
agency, WABA, phone number or `onboarding_type`. The application entry point is
`attachExistingWabaForUser`. When the pinned phone is already attached to the
same agency and WABA, it replaces only `access_token`.

There are two routes for the write: the **in-app route** (the application's
internal endpoint) and the **operator-script route** (a one-off script that
calls `attachExistingWabaForUser` with injected dependencies). Steps 1–3, 5 and
6 apply to both; step 4 applies to the operator-script route only.

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
4. **Operator-script route only: check the key.** A script encrypts the new
   token with whatever `SECRETS_ENC_KEY` it loads, so before writing, confirm
   that key decrypts the connection's current stored value. With AES-GCM, a
   successful decrypt means the script holds the key that encrypted the current
   value. Since production is reading the current value, a value encrypted with
   the same key is expected to be readable by production too, but that is an
   expectation: only the post-write live send confirms it. If it does not
   decrypt, refuse. This check only works while an operator machine holds the
   key used for production values, which is itself an open weakness (see the
   security follow-up below). Once keys are separated, use the in-app route,
   where the production runtime encrypts with its own configured key.
5. **Replace the token.**
   - **Application implementation.** `attachExistingWabaForUser` re-runs the
     Graph checks, then calls `rotateToken`. In the default dependencies, that
     is a single update of `access_token` filtered by `phone_number_id`,
     `agency_id`, `waba_id` and `onboarding_type = 'cloud_api'`. Any result
     other than exactly one affected row is reported as a failure.
   - **In-app route.** Set `WA_MANUAL_ATTACH_ENABLED=1` exactly (any other value
     is off) in the production environment and redeploy. Call
     `POST /api/internal/whatsapp/attach` from a session with the ADMIN role in
     agency 103. Then remove the switch and redeploy again.
   - **Operator-script route.** Inject the dependencies instead of using the
     defaults. `config/db.ts` loads `.env.local` with `override: true` whenever
     it is imported, including indirectly through
     `lib/whatsapp/attachExistingWaba.ts`. (It loads `.env.test` under
     `NODE_ENV=test`, or the file named by `APP_ENV_FILE`.) That replaces
     values already exported in the shell, including `DATABASE_URL` and
     `SECRETS_ENC_KEY`. A production script must therefore use its own explicit
     database client, and must treat the key in that `.env.local` as the one
     that will encrypt. The 2026-10-10 script additionally pinned the update to
     the row `id` and blocked the insert path.
6. **Verify after the write.**
   - The stored value decrypts to the new token, and `debug_token` passes on it.
   - The 2026-10-10 script also restored the backup automatically if the stored
     value did not match or the check failed.
   - The WhatsApp health check, `resolveWhatsappHealth`
     (`lib/whatsapp/operationalStatus.ts`), reports `operational`. Run outside
     the app, it needs injected database dependencies for the same
     `config/db.ts` reason.
   - One approved production send is delivered. This is the check that proves
     the production runtime itself can use the new token. Use a plain-text reply
     inside the 24-hour window, never a Marketing template.
7. **Close out.** Record the rotation below. The old token keeps working until
   its own expiry unless it is revoked; revocation is a separate, approved step.
   The backup may be deleted only with operator approval after the rollback
   window (the old token's expiry) has passed.

## Rotation log

### 2026-10-10: agency 103

- **Connection:** agency 103's manually attached `cloud_api` connection, the
  only one the manual-attach path accepts. Its WABA, phone number and app are
  pinned by the `MANUAL_ATTACH_*` constants in
  `lib/whatsapp/attachExistingWaba.ts`, so identifiers are not repeated here.
  On 2026-10-10, exactly one production `whatsapp_connections` row matched them.
  According to `CLAUDE.md`, the Preview database is a copy of production, so it
  may hold a matching row too; it was not queried. This rotation changed
  production only.
- **Route:** operator-script route (single guarded update pinned to the row
  `id`). No environment change and no deploy.
- **Why:** the old token was issued 2026-09-01 and set to expire 2026-10-31
  12:41 UTC. Its lifetime of exactly 60 days, worked out from those two
  timestamps, suggests the 60-day option was chosen when it was generated; that
  choice itself was not observed. Nothing in the code sets token expiry.
- **New token:** same system user and app, issued 2026-10-10 14:34:13 UTC,
  never expires. Both WhatsApp permissions confirmed.
- **Pre-write validation:** `debug_token` and the full Graph check passed. The
  script's key decrypted the current production value.
- **Write:** exactly one row updated. Afterwards, the other connection rows had
  unchanged identity and contained neither the old nor the new token.
- **Post-write verification:**
  - The stored value decrypts to the new token, and `debug_token` passes.
  - The health check, run locally against production data and Meta (not inside
    the production runtime), reports `operational` (inbound ready, outbound
    ready).
  - Production sending itself: a plain-text reply sent from the production
    inbox to an approved internal test recipient was accepted by Meta and
    reached `delivered`, with no send error.
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
approved rotation plan before anything changes. `lib/crypto/secrets.ts` reads a
single key, with no fallback key.

- **Shared key, verified so far:**
  - In Vercel, the `SECRETS_ENC_KEY` entry for Production and Preview was
    created 2026-05-24, and its last-updated time equals its creation time. That
    suggests it has not been changed, but metadata alone does not prove it was
    never rotated.
  - Directly verified: the key in two local `.env.local` files on one developer
    machine (the repository and one worktree; the two files hold the same value)
    decrypted agency 103's production-stored WhatsApp token value. It decrypted
    the value before this rotation, and it decrypted the new value, which that
    same local key had encrypted. No other production-stored values were tested
    for this record.
  - Not directly verified: which key the Production runtime holds. The
    Production `SECRETS_ENC_KEY` is a sensitive variable and its value cannot be
    read, so no value or fingerprint comparison was done.
  - Inference, not proof: after the rotation, production delivered a send
    through the code path that decrypts this stored value. Because the value had
    been encrypted with the local key, the runtime most likely holds the same
    key. Confirm it with a deliberate check (for example a fingerprint
    comparison performed inside the runtime) before relying on it.
  - Other developer environments were not checked.
- **Inferred impact.** Anyone who holds that key and can read the production
  database can decrypt every value encrypted with it. That includes the agency
  103 WhatsApp token above, which never expires.
- **Preview.** Every Preview deployment uses the same Vercel entry as Production,
  except deployments of the `feat/card-required-trial` branch, which have their
  own branch-scoped `SECRETS_ENC_KEY` entry (since 2026-09-16, value not
  compared).
  - `CLAUDE.md` documents the Preview/Development database (`preview-shared`) as
    a copy of production data. If so, it holds production-encrypted values that
    ordinary Preview deployments can decrypt with the shared key. Its contents
    were not queried for this record.
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
  Because the helper reads only one key, the rotation needs either a one-time
  re-encryption step (decrypt with the old key, encrypt with the new one) or a
  code change that adds a temporary dual-key read window. Production, Preview
  and local must end up with separate keys.
- **Unencrypted tokens.** On 2026-10-10, five `whatsapp_connections` rows stored
  their tokens as plaintext: four Coexistence connections, and one legacy row
  with no `onboarding_type` and no WABA. The reader accepts both formats by
  design. Legacy `facebook_pages` rows may also be plaintext until their Page is
  reconnected. Decide whether to encrypt them as part of the same plan.
