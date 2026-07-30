# Meta Ads "Lead" conversion — Facebook connection

**Status:** implemented. Server-side (Conversions API) only.

## What counts as a Lead

For the Meta Ads campaign, a **Lead is not a registration.** It is exactly one thing:

> A newly registered agency has **successfully persisted** a Facebook Page
> connection — the `facebook_pages` row is committed, after the leadgen webhook
> subscription was confirmed.

Explicitly **not** a Lead: page visit, signup/registration, onboarding, clicking
"Connect Facebook", OAuth start, or the OAuth callback.

The callback is worth calling out: it exchanges tokens and discovers Pages, but it
**persists nothing** — the discovered Pages go into a 10-minute encrypted `fb_pages`
cookie. A user can complete the entire OAuth flow and never connect. That is why the
conversion cannot fire there.

## Where it fires

`app/api/auth/facebook/connect/route.ts`, immediately after the `facebook_pages`
upsert resolves. At that single point all of the following are true:

- token exchanged and long-lived,
- `leads_retrieval` verified as actually granted (Meta lets users uncheck scopes),
- the Page is subscribed to `leadgen` **and** the subscription was confirmed,
- cross-tenant ownership cleared,
- the row is committed to the database.

The send is scheduled inside `after()`, so the HTTP response has already been
returned before any Meta call begins. **A Meta outage, timeout, bad token, or
rejection therefore cannot delay or fail the Facebook connection.** The signal
capture in the request path uses optional chaining for the same reason.

## Idempotency — two independent layers

A paid conversion counted twice is a real financial reporting error, so there are two:

1. **Local marker.** A `meta_capi_lead_sent` row in `analytics_events`, scoped per
   agency, checked before sending and written only after a confirmed send. This
   survives disconnect → reconnect (the disconnect route deletes the
   `facebook_pages` row but never analytics history), callback retries, refreshes,
   and repeated OAuth flows.
2. **Deterministic `event_id`** — `fb-connected-lead-agency-<agencyId>`. Meta
   collapses events sharing `(event_id, event_name)`, so even a race between two
   concurrent connects — where both pass the existence check before either writes
   the marker — is deduplicated Meta-side.

A **failed** send deliberately does *not* write the marker, so the next successful
connection retries the conversion instead of silently losing it. A successful send
always writes it.

Dedup is scoped **per agency**, not per user: the agency is the tenant that
converted. It matches both the `facebook_pages` tenancy model and the existing
`trackFirstRealLeadOnce` precedent. Two users in one agency connecting Pages is one
business conversion.

## Pixel / CAPI deduplication

**No browser Pixel `Lead` is fired anywhere** — CAPI is the sole source for this
conversion, so double counting is structurally impossible rather than merely
guarded. The `MetaStandardEvent` union in `lib/facebook/pixelEvents.ts` has no
`'Lead'` member, so a client-side `Lead` will not typecheck.

If a Pixel `Lead` is ever added for this same conversion, pass the shared id:

```ts
import { facebookConnectedLeadEventId } from '@/lib/facebook/metaLeadConversion'
fbq('track', 'Lead', {}, { eventID: facebookConnectedLeadEventId(agencyId) })
```

Meta will then count the Pixel/CAPI pair once.

## Dataset

Server events are sent to **`NEXT_PUBLIC_META_PIXEL_ID`** — deliberately the same
variable the browser Pixel initialises with, so server and browser events can never
land in different datasets. There is intentionally **no separate dataset override**:
one knob, one destination.

Current value is `2587091141705317` ("Social CRM Production") in `.env`,
`.env.local`, and `.env.production.local` — the dataset used by the Ads campaign.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_META_PIXEL_ID` | already configured | Dataset/Pixel id for **both** Pixel and CAPI. Must stay `2587091141705317` for the campaign to attribute. |
| `META_CAPI_ACCESS_TOKEN` | **NEW — must be added** | Conversions API access token. Without it the conversion is a logged no-op (`[meta-capi]:skip … not_configured`) and nothing breaks. |
| `META_CAPI_TEST_EVENT_CODE` | optional | Routes events to the Events Manager **Test Events** tab for verification. Leave unset in production. |

### Generating `META_CAPI_ACCESS_TOKEN`

Events Manager → Data Sources → **Social CRM Production** (`2587091141705317`) →
Settings → Conversions API → **Generate access token**. Add it to Vercel Production
(and Preview, if you want preview traffic attributed — usually you do not).

`META_GRAPH_VERSION` (existing, defaults to `v19.0`) controls the Graph version used
for the `/events` call.

## Verifying end to end

1. Set `META_CAPI_TEST_EVENT_CODE` to the code shown in Events Manager → Test Events.
2. Register a new agency, connect a Facebook Page through to Page selection.
3. Expect one `Lead` in Test Events with `event_id` = `fb-connected-lead-agency-<id>`,
   `action_source: website`, and hashed `em` / `external_id`.
4. Disconnect and reconnect — **no second event** should appear.

Server logs to grep: `[meta-lead-conversion]:sent`, `:skip` (already sent),
`:not_sent`; and `[meta-capi]:sent`, `:skip`, `:failed`, `:threw`.

## Privacy

`em` and `external_id` are SHA-256 hashed (trimmed + lowercased) before leaving the
process; raw email is never transmitted. `client_ip_address`, `client_user_agent`,
`fbp`, and `fbc` are sent unhashed per Meta's specification.

## Files

| File | Role |
| --- | --- |
| `lib/facebook/conversionsApi.ts` | Low-level CAPI transport. Never throws. The only server-side Meta events client — do not add a second. |
| `lib/facebook/metaLeadConversion.ts` | The conversion's business rule + idempotency. Exports `facebookConnectedLeadEventId`. |
| `app/api/auth/facebook/connect/route.ts` | The sole caller, at the authoritative success point. |
| `lib/analytics/track.ts` | `meta_capi_lead_sent` marker event name. |
| `__tests__/connections/metaLeadConversion.test.ts` | ML-1…ML-13. |
