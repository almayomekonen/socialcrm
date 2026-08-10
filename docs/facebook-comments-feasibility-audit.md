# Facebook Page Comments → SocialCRM — Phase 1 Feasibility Audit

**Date:** 2026-08-10 · **Status:** audit only. No production behaviour, schema, scope,
webhook subscription or UI was changed. One new dev-only file:
`scripts/probe_facebook_comments.cjs` (read-only, not imported by the app).

**Verdict:** `REQUIRES ADDITIONAL META PERMISSION` — see §C.

---

## A. Existing architecture

### Facebook OAuth

| File | What it does |
| --- | --- |
| `app/api/auth/facebook/route.ts` | Initiates OAuth. Sets a 10-min `fb_oauth_state` CSRF cookie (`<origin>.<uuid>`), redirects to `https://www.facebook.com/v18.0/dialog/oauth`. **Requests scopes `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`** (line 27). |
| `app/api/auth/facebook/callback/route.ts` | Exact-match CSRF check → code→short token → `fb_exchange_token`→long-lived user token → `/me/permissions` (hard-fails if `leads_retrieval` was not granted; records whether `pages_show_list` was) → `/me/accounts` for the Page list → encrypts the list into a 10-min `fb_pages` cookie → redirects to the picker. |
| `app/api/auth/facebook/connect/route.ts` | Page selection. Cross-tenant ownership check → `POST /{page-id}/subscribed_apps` with `subscribed_fields: 'leadgen'` → **only then** upserts `facebook_pages` (`onConflict('page_id')`). Emits lifecycle + Meta CAPI conversion in `after()`. |
| `app/api/auth/facebook/disconnect/route.ts` | Best-effort `DELETE /{page-id}/subscribed_apps`, then deletes the row by `user_id`. |
| `app/api/facebook/callback/route.ts` | Deliberately dead (410). Do not re-enable — duplicate `redirect_uri`. |
| `components/settings/FacebookConnect.tsx` | Three-state client UI (not connected / page picker / connected). |
| `components/settings/integrations/LeadSourcesSection.tsx` | Server component that loads the connection + live health for the settings page. |

**Token handling — verified:**
- The stored credential is a **Page access token derived from a long-lived user token**. There is no refresh mechanism, no `expires_at` column, and no scheduled re-validation; such tokens do not expire on a timer but die with the parent user token.
- It is stored **in plaintext** in `facebook_pages.page_access_token` (`text`). The repo has a `SECRETS_ENC_KEY` + `encrypt()/decrypt()` pair used for the transient `fb_pages` cookie, but not for the stored Page token.
- Expiry is detected **reactively**: a 401/403 on the webhook's lead fetch flips `health_status = 'token_expired'` and triggers `repairFacebookConnection`.

### Page connections (DB)

`facebook_pages` — created by `db/migrations/facebook_pages.sql`, extended by
`migrations/20260323000003_facebook_pages_health.cjs`:

```
id                serial PK
user_id           integer NOT NULL REFERENCES users(id) ON DELETE CASCADE
agency_id         integer NOT NULL          -- no FK constraint
page_id           varchar(64) NOT NULL      -- UNIQUE (global, across all agencies)
page_name         varchar(255) NOT NULL
page_access_token text NOT NULL             -- plaintext
created_at        timestamptz DEFAULT now()
health_status     string NOT NULL DEFAULT 'unknown'   -- healthy|token_expired|not_subscribed|unknown
health_checked_at timestamp
```
Indexes: `UNIQUE (page_id)`, `(user_id)`, `(page_id)`.

There are **no Prisma models** — the data layer is knex (`config/db.ts`,
`migrations/*.cjs`). One Page per row; a user has at most one connected Page in
practice (every read does `.first()`).

Related table: `webhook_failures` (`migrations/20260323000002_*`) — the failure ledger
for the leadgen path.

### Existing Lead Ads implementation (the closest analogue)

`app/api/webhooks/facebook/route.ts` is the whole ingest path:

1. `GET` — Meta handshake, compares `hub.verify_token` to `META_VERIFY_TOKEN`.
2. `POST` — `X-Hub-Signature-256` HMAC-SHA256 over the raw body with `META_APP_SECRET`, compared with `timingSafeEqual`. Rejects 403 on mismatch.
3. Loops **all** `entry[]` × `changes[]`, reads `change.value.leadgen_id` and `entry.id` (the Page id). `change.field` is never inspected.
4. Per lead: skip `test_` ids → early dedup on `clients.leadSource = 'facebook:{leadId}'` → resolve `facebook_pages` by `page_id` → `GET /v19.0/{leadId}?fields=field_data` with `Authorization: Bearer` (6 s abort, **one** retry, timeout only) → `parseFacebookLead` → `createLeadFromWebhook`.
5. Errors are classified into `webhook_failures` (`fetch_error`, `timeout`, `token_expired`, `graph_api_error`, `db_error`, `unhandled_error`). 401/403 additionally marks the connection expired and kicks off repair.
6. `lib/system/createClientFromWebhook.ts` → dedup by `leadSource`, then by phone → `insertLeadSystem` (`idNum: FB_{leadId}`, `leadSource: facebook:{leadId}`) → `trackFirstRealLeadOnce` → `createSystemTask` → `emitAutomationEvent({trigger:'lead_created', origin:'webhook_facebook'})`.

Supporting utilities: `lib/facebook/graph.ts` (version constants),
`lib/facebook/health.ts` (`checkFacebookConnection` / `repairFacebookConnection`,
6 s timeouts), `lib/adapters/facebookLead.ts`, `lib/facebook/metaLeadConversion.ts`,
`lib/facebook/conversionsApi.ts`, `lib/connections/reasons.ts` + `messages.ts`
(Hebrew failure vocabulary).

### Existing Meta webhooks

Two routes, one Meta app, one shared `META_VERIFY_TOKEN` and one shared
`META_APP_SECRET`:

- `app/api/webhooks/facebook/route.ts` — the `page` object.
- `app/api/webhooks/whatsapp/route.ts` — the `whatsapp_business_account` object (richer: ingest, statuses, template status, auto-response worker, `maxDuration = 60`).

**Subscribed fields today: `leadgen` only.** It is written in exactly two places —
`connect/route.ts:48` and `health.ts:125`. Nothing subscribes to `feed`, and
grep confirms **no comment/feed handling exists anywhere in the repo**.

---

## B. Current Meta integration — summary

- **Graph version:** `lib/facebook/graph.ts` exports `META_GRAPH_VERSION || 'v19.0'`; `.env` and `.env.production.local` both set `v19.0`. **But the constant is used by `health.ts` only.** Everything else hardcodes its version: `v19.0` in the callback (×4) and the webhook lead fetch; **`v18.0`** in `connect` (subscribe + verify), `disconnect`, and the OAuth dialog URL. Any comments work should route through `GRAPH_BASE`, not add a fourth hardcoded version.
- **Token available:** a long-lived-derived **Page access token** per connected Page, stored plaintext, no refresh, reactive expiry detection.
- **Scopes requested:** `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`. **Neither `pages_read_engagement` nor `pages_read_user_content` is requested anywhere in the codebase.**
- **Grant verified at runtime:** `leads_retrieval` only (hard gate). `pages_show_list` is observed for analytics; `pages_manage_metadata` is never verified.
- **Page connection flow:** OAuth → `/me/accounts` → encrypted cookie → user picks → subscribe `leadgen` → upsert. Subscription failure aborts the save by design.
- **Webhook architecture:** signature-verified, batch-safe, per-item isolated, with a failure ledger and self-repair. It is a sound base for a second event type.

---

## C. Comments feasibility

### `REQUIRES ADDITIONAL META PERMISSION`

**Why — the Graph read path (posts + comments) is blocked:**

1. `GET /{page-id}/feed` (and `/posts`) requires, per Meta's own reference, *"The `pages_read_engagement` permission… The `pages_read_user_content` permission"* — both.
2. For comments, Meta states: *"The same permissions required to view the parent object are required to view comments on that object."* The Page-post comments reference documents error **283** as naming `pages_read_engagement` and/or `pages_read_user_content`, and notes the **MODERATE** task is needed even to read a comment's `id`.
3. `pages_read_engagement` is scoped to *"content (posts, photos, videos, events) posted **by the Page**"* — it never mentions comments. The permission that explicitly covers them is `pages_read_user_content`: *"read user generated content on the Page, such as posts, **comments**, and ratings by users or other Pages."*
4. SocialCRM requests **neither**. This is decisive independent of App Review status: a permission that is approved but never requested in the OAuth dialog is not present on the issued token. Every currently stored Page access token was minted from that three-scope dialog.

**Important correction to the brief's premise:** the audit found no evidence in the
repository that `pages_read_engagement` is in use or was ever requested. Whatever its
App Review status in the Meta dashboard, it is **not on any token this system holds**.
And even with it, it would not be sufficient — comments need `pages_read_user_content`.

**The webhook path is a different story — and is the cheaper route.** Meta documents the
Page `feed` webhook field as requiring only **`pages_manage_metadata` and `pages_show_list`**,
both of which SocialCRM already requests. `feed` delivers comment events with
`item`, `verb`, `comment_id`, `post_id`, `from {id, name}` and `message`. So real-time
comment *capture* may be reachable with today's permission set by adding `feed` to
`subscribed_fields` — while comment *backfill/history* (reading existing posts and their
existing comments) cannot be, because that is the Graph read path above.

One unknown remains, flagged honestly as an **assumption, not a verified fact**: Meta's
general webhook rule says *"you won't receive notifications unless your app has been
approved for the login permission that corresponds to that type of data."* Whether
`from` and `message` arrive fully populated for user comments without
`pages_read_user_content` is not settled by the documentation. §F's next step is the
experiment that settles it.

---

## D. Actual API test

**Not executed — genuinely blocked by the development environment.**

`scripts/probe_facebook_comments.cjs` was written and run. The local dev database
(`.env.local` → `localhost/socialcrm`) contains **zero rows in `facebook_pages`**, so
there is no Page token to probe with:

```
Graph version: v19.0
Env file:      .env.local
Scopes requested by app/api/auth/facebook/route.ts: pages_show_list, pages_manage_metadata, leads_retrieval

NO CONNECTED PAGE in this database — cannot probe.
```

The probe is ready and does four GETs, writes nothing, and never prints a token
(sent as `Authorization: Bearer`; a scrubber strips known secrets from all output):

| # | Endpoint | Fields | Proves |
| --- | --- | --- | --- |
| 1 | `/debug_token?input_token=…` | — | `scopes` + `granular_scopes` actually on the stored token, `is_valid`, `expires_at` |
| 2 | `/{page-id}` | `id,name` | token baseline |
| 3 | `/{page-id}/posts?limit=5` | `id,created_time,message` | `pages_read_engagement` |
| 4 | `/{post-id}/comments?limit=5` | `id,message,created_time,from{id,name}` | `pages_read_user_content` |

Failures are captured as HTTP status, Meta `code` / `error_subcode` / `type` / `message` /
`fbtrace_id`, plus endpoint, Graph version and requested fields.

Run it against an environment that has a connected Page:

```bash
ENV_FILE=.env.production.local node scripts/probe_facebook_comments.cjs
```

Step 1 is the one that cannot be answered from source code — it reports what the *actual*
stored tokens carry, which could differ from the current scope list if a token predates a
scope change.

**Validation after adding the probe:** `npx tsc --noEmit` clean (exit 0);
`npm run test:a11y` 109/109 passed; `__tests__/connections` 40/40 passed.

---

## E. Recommended production architecture

*(Recommendation, not verified fact. Assumes the permission question in §F resolves.)*

**Webhook-first, polling only as a bounded backfill.** Comments are bursty and
latency-sensitive; the `page` webhook already points at `/api/webhooks/facebook` with
signature verification, batching and a failure ledger. Polling every Page's feed would
burn rate limit for nothing and cannot beat the webhook to the event. Poll only to
backfill history once at connect time, and as a repair sweep when the failure ledger
shows gaps.

**Webhook strategy.** Add `feed` to `subscribed_fields` alongside `leadgen` in the two
places that write it (`connect/route.ts`, `health.ts`) and extend `health.ts`'s
subscription check accordingly. In the route, branch on `change.field`: `'leadgen'` keeps
today's path byte-for-byte; `'feed'` routes to a new
`lib/system/ingestFacebookComment.ts`. Ignore `verb: 'remove'`/`'hide'` initially, and
ignore `from.id === page_id` (the Page replying to itself). The existing route is already
safe against `feed` events arriving early — it skips any change without `leadgen_id`.

**DB changes eventually needed** (additive only, mirroring the inbox doctrine):

```
facebook_page_comments
  id             bigserial PK
  "agencyId"     integer NOT NULL          -- denormalised from facebook_pages, the tenant key
  "pageId"       varchar(64) NOT NULL
  "postId"       text NOT NULL
  "commentId"    text NOT NULL             -- UNIQUE → the dedup key
  "parentCommentId" text                   -- replies
  "authorExternalId" text                  -- page-scoped id, NOT a phone/email
  "authorName"   text
  message        text NOT NULL DEFAULT ''
  status         text NOT NULL DEFAULT 'unhandled'  CHECK (unhandled|handled|ignored)
  "leadId"       integer REFERENCES clients(id) ON DELETE SET NULL
  "channelTimestamp" timestamptz
  "rawPayload"   jsonb
  "createdAt"/"updatedAt" timestamptz
```
Indexes: `UNIQUE ("commentId")`, `("agencyId", status, "channelTimestamp" DESC)`,
`("agencyId","postId")`, `("leadId")`.

**Deduplication.** `UNIQUE (commentId)` + `ON CONFLICT DO UPDATE` — the same shape as
`clients.leadSource` unique + `onConflict('page_id')`. Meta redelivers on non-2xx, so
idempotency is mandatory, not optional.

**Comment → Lead.** Never a new entity (`claude/product.md`: one entity, Lead).
`insertLeadSystem` with `leadSource: 'facebook_comment:{commentId}'`, exactly parallel to
`facebook:{leadId}`, then `emitAutomationEvent({trigger:'lead_created', origin:'webhook_facebook'})`.
**Note a real constraint:** a comment carries a name and a page-scoped id — **no phone, no
email**. The phone-based dedup in `createClientFromWebhook` cannot apply, and such a lead
is not directly callable. Converting a commenter into a *contactable* lead requires a
human step or a private reply. Design the flow around that truth rather than around a lead
that looks complete and is not.

**API routes.** `GET /api/facebook/comments` (list, agency-scoped, cursor paginated),
`POST /api/facebook/comments/[commentId]/status`, `POST /api/facebook/comments/[commentId]/lead`.
No new webhook endpoint.

**Authorization model.** `pageId` from the webhook payload → `facebook_pages` row →
`agency_id`/`user_id` — identical to the leadgen path, never trusting client input. Every
read/write filters on the session `agencyId` server-side. `commentId` is a Meta-global
identifier, so a route keyed on it **must** re-check ownership; keying on it alone would be
an IDOR.

**Frontend.** Reuse existing table/list primitives and `MetaLeadAdsBadge`; no new layout,
no new design system (`claude/ux-guidelines.md` §11–12). One page-level state at a time:
system-empty (not connected / no comments) vs data. Hebrew terminology: `ליד`, `נציג`.

**Pagination.** Cursor-based (Meta returns `paging.cursors.after`) for backfill;
keyset pagination on `("agencyId", "channelTimestamp")` for the UI.

**Rate limiting.** Page-level Graph limits apply to the backfill only. Cap it (e.g. last
N posts / last 30 days), persist the cursor, back off on code 4 / 17 / 32 / 613, and stop
on terminal errors — the same discipline as the existing 6 s timeout + single retry.

**Error handling.** Reuse `webhook_failures` with new `error_type` values rather than a
second ledger, and reuse `lib/connections/reasons.ts` for user-facing Hebrew copy.

**Sync strategy.** Webhook = live truth. Backfill once at connect. A repair sweep, only
if the ledger proves it is needed — per `feedback_optimize_from_evidence`, do not build
reconciliation for a drift that has not been observed.

---

## F. Exact next step

**Do this, in this order. Do not start building.**

1. **Run the probe against production** (read-only, ~1 minute, changes nothing):
   `ENV_FILE=.env.production.local node scripts/probe_facebook_comments.cjs`
   Step 1's `scopes` line is the ground truth on what the live tokens carry. Everything
   below assumes the expected result (`pages_read_engagement: ABSENT`,
   `pages_read_user_content: ABSENT`); if either is unexpectedly PRESENT, the plan changes
   and steps 3–4 collapse into "just read the API."

2. **Check the Meta App Dashboard** for the app behind `META_APP_ID` — which permissions
   are *approved* vs *requested*. App Review status is not queryable from code, so this is
   the one fact this audit could not establish. It decides whether §C's blocker is a
   one-day change or a multi-week App Review.

3. **Then choose the path:**
   - *If `pages_read_user_content` + `pages_read_engagement` are already approved:* add them
     to the OAuth scope list. Note the cost — **every existing connected user must
     re-authorise**; tokens are not retroactively upgraded. That needs a reconnect prompt
     designed around `FACEBOOK_NOTICES`, not a silent break.
   - *If they are not approved:* App Review for `pages_read_user_content` is the long pole.
     Start it before writing feature code, because it gates the entire read path.

4. **In parallel — the experiment that needs no new permission.** Add `feed` to
   `subscribed_fields` for **one canary Page**, and log the sanitized payload shape without
   persisting anything. This is the only way to settle the §C unknown: whether `from` and
   `message` arrive populated under today's permissions. If they do, real-time comment
   capture ships *without* App Review, and the read path becomes a history-backfill
   nice-to-have rather than the blocker.

**Recommendation:** run 1 and 2 today, then do 4 before committing to 3. Step 4 is cheap,
reversible (unsubscribe restores the current state exactly), and could remove App Review
from the critical path entirely.

---

## G. Canary experiment — runbook and status

Built 2026-08-10. **Not yet executed** — it fails closed here because no Page is
connected in the dev database and `FACEBOOK_COMMENTS_CANARY_PAGE_ID` is unset.

| File | Role |
| --- | --- |
| `lib/facebook/commentsCanary.ts` | Env gate + presence-only payload summariser. No persistence, no Lead, no automation event. |
| `app/api/webhooks/facebook/route.ts` | +21 lines, 0 removed: `change.field === 'feed'` → observe → `continue`. |
| `scripts/facebook_comments_canary.cjs` | `status` / `subscribe` / `unsubscribe`, gated on the env var + a real `facebook_pages` row. |
| `__tests__/connections/facebookCommentsCanary.test.ts` | 14 tests: leadgen unchanged, gate fails closed, batch isolation, malformed input, no content in logs. |

**Run it:**

```bash
export FACEBOOK_COMMENTS_CANARY_PAGE_ID=<one page_id from facebook_pages>
ENV_FILE=.env.production.local node scripts/facebook_comments_canary.cjs status
ENV_FILE=.env.production.local node scripts/facebook_comments_canary.cjs subscribe
# set the same env var in Vercel so the webhook observes the Page, redeploy,
# then post a comment on one of that Page's posts and read the function logs for
# [FacebookCommentsCanary]
ENV_FILE=.env.production.local node scripts/facebook_comments_canary.cjs unsubscribe
```

**Rollback:** `unsubscribe` re-POSTs `subscribed_fields=leadgen` — Meta replaces
the set on POST, so the Page returns to exactly the state the connect flow
creates. Unsetting the env var alone also disables all observation.

**Read the result as:**

| Observation | Meaning |
| --- | --- |
| `feed: ACTIVE` after `subscribe`, and events arrive with `authorIdPresent`/`messagePresent` true | `REAL-TIME COMMENTS CONFIRMED` — MVP possible without App Review |
| events arrive but `authorIdPresent` or `messagePresent` false | `PARTIALLY CONFIRMED` — `pages_read_user_content` needed for the missing part |
| `feed` not retained, or no events after a real comment | `NOT CONFIRMED` |

---

## Appendix — verified facts vs assumptions

**VERIFIED (read from this repository or quoted from Meta's reference docs):**
- Requested scopes are `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`; neither `pages_read_engagement` nor `pages_read_user_content` appears anywhere in the codebase.
- Graph version is `v19.0` via env, but only `health.ts` uses the constant; `v18.0` is hardcoded in `connect`, `disconnect` and the OAuth dialog.
- `subscribed_fields` is `'leadgen'` only, written in exactly two places.
- No comment/feed handling exists in the repository.
- `facebook_pages` schema, indexes and the plaintext token column, as listed in §A.
- Webhook signature verification, batching, retry and failure-ledger behaviour, as listed in §A.
- Cross-tenant Page claiming is rejected at connect time (409); the webhook derives tenancy from the Page row.
- Meta requires `pages_read_engagement` **and** `pages_read_user_content` for `/{page-id}/feed`; comments inherit the parent object's permissions; `pages_read_engagement` covers Page-authored content only; `pages_read_user_content` explicitly covers user comments; the Page `feed` webhook field requires `pages_manage_metadata` + `pages_show_list`.
- The local dev DB has zero connected Pages; `tsc` is clean and the a11y (109) and connections (40) suites pass with the probe added.

**ASSUMPTION / NOT VERIFIED:**
- Which permissions the Meta App Dashboard has **approved** (not queryable from code).
- What the **live production** tokens actually carry — the probe answers this; it has not been run against production.
- Whether `from` / `message` arrive populated in `feed` webhook payloads without `pages_read_user_content`.
- Everything in §E is a recommendation, not a measured design.

**Sources:**
[Object Comments](https://developers.facebook.com/docs/graph-api/reference/v23.0/object/comments) ·
[Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/) ·
[Page Post Comments](https://developers.facebook.com/docs/graph-api/reference/page-post/comments/) ·
[pages_read_engagement](https://developers.facebook.com/docs/permissions/reference/pages_read_engagement/) ·
[pages_read_user_content](https://developers.facebook.com/docs/permissions/reference/pages_read_user_content/) ·
[Webhooks Reference: Page](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/) ·
[Webhooks for Pages](https://developers.facebook.com/docs/pages-api/webhooks-for-pages) ·
[Permissions Reference](https://developers.facebook.com/docs/permissions/)
