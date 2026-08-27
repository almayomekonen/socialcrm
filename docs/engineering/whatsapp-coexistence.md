# WhatsApp Business App Coexistence

## Why this exists

Customers who already run the WhatsApp Business App were being pushed into a
screen demanding they delete or migrate their number, and they abandoned
onboarding there. That was not a bug in our code — it is Meta's documented
behaviour for the **default** Cloud API flow:

> "To use an existing WhatsApp Business app phone number with Cloud API, you must
> either delete your account, or onboard to the platform using a solution
> provider who supports business app number onboarding."

Coexistence is the supported alternative: the same number stays live on the
WhatsApp Business App while also connected to Cloud API, with messages synced
both ways.

## What changed

| Area | Change |
| --- | --- |
| [`lib/facebook/useEmbeddedSignup.ts`](../../lib/facebook/useEmbeddedSignup.ts) | Sends `featureType: 'whatsapp_business_app_onboarding'`; handles `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` alongside `FINISH`; records which flow completed; hardened origin check |
| [`lib/whatsapp/coexistence.ts`](../../lib/whatsapp/coexistence.ts) | New. Event names, the webhook-field guard, phone-number resolution, `smb_app_data` sync |
| [`app/api/whatsapp/embedded-signup/route.ts`](../../app/api/whatsapp/embedded-signup/route.ts) | Resolves `phone_number_id` from `waba_id` when absent; skips registration for coexistence; runs the one-time sync |
| [`lib/whatsapp/registration.ts`](../../lib/whatsapp/registration.ts) | `skipRegistration` option |
| [`app/api/webhooks/whatsapp/route.ts`](../../app/api/webhooks/whatsapp/route.ts) | Coexistence webhook fields acknowledged and never treated as inbound |

### The origin check

Meta's sample uses `origin.endsWith('facebook.com')`, which also matches
`https://evilfacebook.com`. We validate the parsed hostname instead — exact
known hosts or a true `*.facebook.com` subdomain over HTTPS. Stricter than the
sample where it matters; broader than our previous two-host allowlist, which
risked silently dropping the coexistence event.

### Why registration is skipped

Meta: *"use them to onboard the customer as you normally would, but skip the
phone number registration step, as the number is already registered."*
Registration is how a number is claimed for Cloud API — precisely what
coexistence exists to avoid.

### Why echoes are guarded

`smb_message_echoes` carries messages the **business** sent from their own
phone. Treating one as inbound would create a lead from the business's own
message and could fire an automated reply at a real customer. Their payloads sit
under `message_echoes` / `history` / `state_sync` rather than `messages`, so the
existing reader would not pick them up — the explicit guard is the second lock,
placed before any ingestion so a later edit cannot quietly undo it.

### Sync ordering

Contacts (`smb_app_state_sync`) must complete before history. History is only
attempted if contacts succeeded, because the step may be performed **once**, and
there is a **24-hour** window before the customer must be offboarded and redo the
flow.

### Graph version

`smb_app_data` postdates the app-wide `v19.0`, so this feature pins its own
version (`META_COEXISTENCE_GRAPH_VERSION`, default `v25.0`). Deliberately not a
global bump: `GRAPH_VERSION` is used by message sending, template sync, health
checks and the Conversions API, and moving all of those is a separate change.

## Required dashboard configuration — not done by this code

Subscribe the WhatsApp app to these webhook fields in
**App Dashboard → WhatsApp → Configuration**:

- `history`
- `smb_app_state_sync`
- `smb_message_echoes`

Meta: *"make sure… you are subscribed to the additional webhook fields,
otherwise you will miss important webhooks."* Until this is done, the sync will
be requested but its data will never be delivered.

> **Before activating history, follow
> [`whatsapp-history-activation.md`](./whatsapp-history-activation.md)** — the
> pre-flight checklist, the two-key gate, the activation order and the rollback
> procedure. The archive is one-shot; an unsubscribed field spends it for
> nothing.

## Rollback

`NEXT_PUBLIC_WA_COEXISTENCE_DISABLED=1` restores the previous `featureType: ''`
behaviour while keeping phone resolution, the echo guard and the registration
skip. Requires a redeploy (Next.js inlines `NEXT_PUBLIC_*` at build time), but it
is a config flip rather than a code revert.

## Known unknowns

1. **Embedded Signup version.** If our Login configuration is v4, Meta moves flow
   selection into the configuration and `featureType` may be inert — in which
   case customers still see the migration screen and the dashboard must be
   changed instead. Not determinable from the repo, and not testable on a preview
   because Facebook Login only runs on the app's allowlisted domain.
2. **Advanced Access.** If `whatsapp_business_management` /
   `whatsapp_business_messaging` are at Standard access on a live app, customers
   without a role on the app are never asked to grant them and onboarding cannot
   complete regardless of this feature. Check **App Review → Permissions and
   Features**.

## Deliberately out of scope

Ingesting echo and history payloads into the inbox timeline. Importing a
business's entire message history could mass-create leads and flood the CRM,
which is a product decision, not an implementation detail. The webhooks are
acknowledged safely today; ingestion is a separate, deliberate piece of work.
