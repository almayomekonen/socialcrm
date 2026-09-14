# Meta App Review — implementation, configuration and rollout

Branch `feat/meta-app-review`, based on `origin/main` @ `08cd1d33`. `main` has
since advanced to `662d7cac` (PR #52, Instagram in-app-browser warning), which
touches six of the same files; integrate before opening a PR (see §7). Covers the four
permissions in the App Review draft: `pages_read_user_content`,
`pages_manage_engagement`, `pages_messaging`, `ads_read`.

This document is the engineering source of truth. Submission copy lives in
[`submission.md`](./submission.md); privacy/data-deletion changes in
[`privacy-and-data-deletion.md`](./privacy-and-data-deletion.md).

> Nothing here is App Review approval. Before approval every permission is at
> Standard Access: it works only for people with a role on the app (admin,
> developer, tester) and their assets.

---

## 1. What exists after this branch

| Area | Before (origin/main) | After |
| --- | --- | --- |
| Comment ingestion | `feed` webhook → `facebook_page_comments`, agency from the signed `entry.id` | Unchanged, plus: the Page's own comments are flagged `authorIsPage`, never notify, never appear as work items, cannot become leads |
| Comment context | Author, text, time, "reply to comment" badge | Plus: link to the post on Facebook (opened at the comment), and the reply thread (users + Page) under each comment |
| Reply to comments | Not implemented | `replyToComment` → `POST /{root-comment-id}/comments` as the Page; reply recorded from the Graph response; webhook echo dedupes on `("pageId","commentId")` |
| Messenger | Not implemented; `entry.messaging` was silently dropped | Inbound + echoes stored (`messenger_*` tables), Messenger tab inside שיחות, history, text replies inside the 24h window, unread per user, create/link lead, attachments + unsupported fallback |
| Ad reporting | None | `/sum_sales/ads` (ביצועים → מודעות): ad account + date range → spend, impressions, clicks, CTR, CPC, per-campaign table |
| Permissions | One scope set for everything | Base set unchanged; each feature requests only its own permissions (`?feature=comment_replies`, `?feature=messenger`, separate `ads_read` flow) |
| Page tokens | Plaintext in DB; sent to the browser during Page selection; `/connect` trusted a token from the request body | Sealed at rest (AES-256-GCM, `SECRETS_ENC_KEY`, `scm1.` prefix, legacy plaintext still readable); the pending-Pages cookie is one encrypted envelope; browser receives `{id,name}` only; `/connect` resolves the token server-side. All new Graph calls send the token in the `Authorization` header. **Not changed** (server-to-server, never logged, left untouched to avoid altering Lead Ads onboarding): the OAuth code/token exchange and Page discovery (`discoverPages.ts`, `pageDiscoveryDiagnostics.ts`) still pass tokens as query parameters |
| Reconnect | A connected Page's reconnect never refreshed its token on desktop (picker not shown) | Callback refreshes the Pages **this admin** connected, server-side (token, grant, webhook fields). Pages another admin connected, and the activation flow, keep the existing picker path |
| Webhook retries | Every failure acknowledged with 200 | Unchanged for the endpoint: always 200 (it also carries Lead Ads; a sustained non-2xx gets the app's webhooks disabled). A Messenger event hitting a transient DB error gets one immediate in-request retry; if that fails it is logged (no content) and lost — a durable Messenger retry ledger is a follow-up that needs a schema change |

### Deliberately not built

- **Messages outside the 24h window.** Only `messaging_type: RESPONSE`. The
  `HUMAN_AGENT` tag is a separately reviewed feature that was not requested;
  outside the window the composer explains the rule and sends nothing.
- **Messenger notifications** (bell/push). `message.inbound` deep-links to
  WhatsApp conversation ids; reusing it would open the wrong screen. Unread state
  is shown in the Messenger list. Follow-up if wanted.
- **Messenger in the native mobile API** (`/api/mobile/v1/inbox`). Messenger uses
  its own tables precisely so the native client, which rejects non-WhatsApp rows,
  is unaffected. The mobile *web* workspace does get the Messenger tab.
- **Instagram DMs**, `ads_management`, any campaign mutation.
- **Comment text backfill / Page post text.** Only a link to the post (no
  `pages_read_engagement` post read).
- **A durable retry ledger for Messenger events.** The shared webhook always
  answers 200; a Messenger event that still fails after one in-request retry on a
  transient DB error is logged and not stored. Closing that needs a new table.
- **Admin deletion tool** for a commenter's comments or a Messenger contact's
  conversation (see `privacy-and-data-deletion.md` §3).

---

## 2. Rollout flags (absence-blocks — unset means OFF)

| Variable | Values | Default | Gates |
| --- | --- | --- | --- |
| `FACEBOOK_COMMENTS_ENABLED` | `1` | off | Existing: comment ingest, list, convert — and now in-app replies |
| `FACEBOOK_COMMENTS_AGENCY_ALLOWLIST` | `all` or `103,108` | none | Existing |
| `FACEBOOK_MESSENGER_ENABLED` | `1` | off | Messenger ingest, tab, send, lead actions, and whether a Page is subscribed to `messages,message_echoes` |
| `FACEBOOK_MESSENGER_AGENCY_ALLOWLIST` | `all` or ids | none | same |
| `FACEBOOK_ADS_REPORTING_ENABLED` | `1` | off | ads OAuth, `/sum_sales/ads`, the "מודעות" tab |
| `FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST` | `all` or ids | none | same |

Required, already used elsewhere: `META_APP_ID`, `META_APP_SECRET`,
`META_REDIRECT_URI`, `META_VERIFY_TOKEN`, **`SECRETS_ENC_KEY`** (32 random bytes,
base64 — `openssl rand -base64 32`). A Page connection now **fails closed** if
`SECRETS_ENC_KEY` is missing: confirm it is set in Vercel Production *before*
deploying (Google Drive and WhatsApp manual attach already require it).

A second permission gate always applies on top of the flags: a feature acts only
when Meta's recorded grant for that Page/user includes its permissions.

**Enable locally:** add to `.env.local`
```
FACEBOOK_COMMENTS_ENABLED=1
FACEBOOK_COMMENTS_AGENCY_ALLOWLIST=<your agency id>
FACEBOOK_MESSENGER_ENABLED=1
FACEBOOK_MESSENGER_AGENCY_ALLOWLIST=<your agency id>
FACEBOOK_ADS_REPORTING_ENABLED=1
FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST=<your agency id>
SECRETS_ENC_KEY=<openssl rand -base64 32>
```
Webhooks need a public HTTPS URL (Meta cannot call localhost); use a preview
deployment or a tunnel registered as the callback URL of a *test* app.

**Disable safely:** unset the `*_ENABLED` flag (or remove the agency from the
allowlist) and redeploy. Stored rows are kept; ingest stops (events are
acknowledged and ignored); the tab/route shows its not-enabled state. For
Messenger, Pages keep receiving `messages` webhooks until their next
subscribe/repair; the hourly health repair re-subscribes only when a required
field is missing, so to stop deliveries immediately, reconnect the Page (fields
are recomputed without Messenger) or unsubscribe it.

**Production rollout order:** internal agency 103 → App Review demo agency →
approval → allowlist customers one at a time → `all`.

---

## 3. Database (additive only — apply before deploying code)

| Migration | Change |
| --- | --- |
| `20260914000001_facebook_page_comments_page_replies` | `facebook_page_comments."authorIsPage" boolean NOT NULL DEFAULT false`, `"sentByUserId" integer REFERENCES users ON DELETE SET NULL`, backfill `authorIsPage` where `"authorExternalId" = "pageId"`, indexes `("pageId","parentId")` and partial `("sentByUserId")` |
| `20260914000002_create_messenger_tables` | `messenger_conversations` (unique `("agencyId","pageId", psid)` — a Page reconnected by another agency starts fresh conversations), `messenger_messages` (unique `("pageId", mid)`), `messenger_conversation_reads` (unique `("conversationId","userId")`); indexes on the `sentByUserId` / `userId` foreign keys |
| `20260914000003_create_facebook_ad_connections` | `facebook_ad_connections` (unique `("agencyId","userId")`, sealed `accessToken`) |

Verified locally on Postgres 18: fresh build (baseline + all migrations), each
migration `down` then `up`, and the backfill (a Page-authored row flips to
`true`, a user row stays `false`).

Production procedure per `claude/release-deployment-workflow.md` §8b:
`npx knex --knexfile knexfile.cjs migrate:list` → confirm exactly these three
pending → `npm run migrate` → record in the deploy report → deploy code.

---

## 4. Meta App Dashboard — exact configuration

App: the SocialCRM app whose id is `META_APP_ID`.

1. **Use cases / permissions.** Keep `pages_read_user_content`,
   `pages_manage_engagement`, `pages_messaging`, `ads_read` in the draft.
   Dependencies Meta requires alongside them (checked 2026-09-14):
   `pages_manage_engagement` → `pages_read_user_content`, `pages_show_list`;
   `pages_messaging` → `pages_manage_metadata`, `pages_show_list`. These are
   already in the base scope set. Do **not** add `ads_management` or Human Agent.
2. **Products.** Messenger must be added to the app (Messenger → API Setup). For
   `ads_read` against the Marketing API, confirm the Marketing API product /
   access tier in the dashboard allows reading insights for app-role users; the
   Graph Explorer test listed accounts but returned no insights rows, so
   insights access with real delivery is **not yet verified**.
3. **Webhooks → Page object** (callback `https://getsocialcrm.com/api/webhooks/facebook`,
   verify token = `META_VERIFY_TOKEN`). App-level subscriptions must include
   `leadgen`, `feed`, **`messages`**, **`message_echoes`**. The per-Page
   subscription (`/{page-id}/subscribed_apps`) is done by the app on connect,
   reconnect and repair. `message_deliveries`, `message_reads` and
   `messaging_postbacks` are not used — leave them off.
4. **Facebook Login → Valid OAuth Redirect URIs** must contain `META_REDIRECT_URI`
   exactly. No new URI is needed: the ads flow reuses it (`ads.` state prefix).
5. **App roles.** Add the reviewer-demo Facebook user(s) and the personal
   Messenger test account as app Testers so Standard Access data flows before
   approval.
6. **Settings → Advanced → "Require App Secret": leave OFF for now.** New code
   sends `appsecret_proof` on every Graph call, but the existing Lead Ads,
   health, WhatsApp and Conversions API paths do not; turning it on would break
   production lead intake. Enable only after those paths are migrated.
7. **Graph API version.** Code uses `META_GRAPH_VERSION` (unset → `v19.0`) plus
   pinned `v18.0`/`v19.0` in older paths; Meta upgrades calls to retired
   versions to the oldest available one. Manual tests used `v26.0`. Changing
   `META_GRAPH_VERSION` also changes WhatsApp calls — treat as its own change.

---

## 5. Exposed test tokens — revocation without disrupting production

Treat every token pasted into Graph API Explorer, a terminal history, a chat or a
screenshot as compromised. Long-lived Page tokens do not expire on their own.

1. **Identify owner and app** without spreading the token further: in Graph API
   Explorer's *Access Token Debugger* (or `GET /debug_token` with an app token,
   run from a server shell), read `app_id`, `user_id`, `scopes`. Note whether the
   token belongs to the SocialCRM app or the "Graph API Explorer" app, and which
   Facebook user.
2. **If the Facebook user is a test-only account** (not the one that connected
   any production Page in SocialCRM): de-authorize the app for that user —
   `DELETE /me/permissions` with that user's token, or Facebook → Settings &
   privacy → Settings → Business integrations → Remove. Meta: de-authorizing
   invalidates every user access token for that person and app; Page tokens
   derived from them stop working. Production connections are unaffected because
   they were issued to other users. Also remove "Graph API Explorer" from that
   user's Business integrations if it was used.
3. **If it is the same Facebook user that connected production Pages**, any
   invalidation (de-authorize, password change, logout-all-sessions) also
   invalidates those Pages' tokens and stops their Lead Ads until reconnected. Do
   it as a planned window, in this order:
   1. Deploy this branch first (the reconnect fix; tokens stored sealed).
   2. Invalidate (de-authorize the app for that user, or change the password).
   3. Immediately reconnect each affected Page in SocialCRM → Settings →
      Integrations → Facebook (reconnect refreshes the stored token server-side).
   4. Verify: `health_status = 'healthy'` for those rows and a test lead from
      Meta's Lead Ads Testing Tool arrives. Then inspect `webhook_failures` rows
      created during the window: failures recorded as `token_expired` are not
      retried automatically (they need the reconnect), so resolve them
      deliberately. Keep the window to minutes.
4. **Revoking only extra permissions** (`DELETE /me/permissions/pages_messaging`)
   does **not** invalidate a leaked token — it still carries the remaining
   scopes. It is not a substitute for step 2 or 3.
5. The app secret was not reported as exposed. If it was: reset it in the
   dashboard and update `META_APP_SECRET` in Vercel in the same minute (webhook
   signatures and `appsecret_proof` both use it).

---

## 6. Verification performed on this branch

Local, `NODE_ENV=test`, Postgres 18 test database (never production):

- `npx tsc --noEmit` — clean.
- Migrations: fresh build from baseline; each of the three `down` → `up`; the
  `authorIsPage` backfill verified on seeded rows.
- New suites (all passing): `__tests__/facebookComments/replyToComment.test.ts`,
  `replyDedup.db.test.ts`; `__tests__/messenger/` (parse/rules, webhook failure
  policy, send + lead actions, webhook → DB end to end incl. echo-before-response
  and a Page moving agencies, UI); `__tests__/adsReporting/`;
  `__tests__/facebook/{graphClient,pageTokenReaders,finishPageOAuth}.test.ts`,
  `refreshConnectedPages.db.test.ts`; lead-source label cases.
- Updated suites (contract changed deliberately): connect route (token only from
  the server-side envelope, sealed at rest), Page discovery (encrypted envelope
  cookie), OAuth scope tests (stale fixture lacked the admin role — these two
  tests were already failing on `main`), comment parser/notification tests,
  integrations-mobile and activation fixtures.
- Full suite (`vitest run __tests__`): the only failures are in 15 files whose
  failure set is **identical on unmodified `origin/main` 08cd1d33** against the
  same database (automations, calendar, lead-isolation, quota, payments,
  subscriptions, WhatsApp history). None touches this work.
- Independent code review (read-only reviewer) — findings addressed: reconnect
  refresh limited to the caller's own Pages and never in activation; the shared
  webhook always answers 200 (one in-request retry for transient DB errors);
  Messenger icon no longer nests a `<div>` in a `<p>`; Messenger and reply-thread
  times formatted in Asia/Jerusalem; `authorIsPage` can never be downgraded;
  conversations keyed per agency; `SECRETS_ENC_KEY` failures handled on every
  path; file-size regressions extracted; reply cap keeps the newest replies;
  sender kept when the echo wins the race; permission buttons only for admins
  (others are told an admin must approve); success feedback after granting or
  reconnecting; ads permission-read failure no longer reported as "declined";
  campaign insights paginated by cursor; ads disconnect no longer revokes the
  grant app-wide; guard test widened. Declined with reasoning: fetching Page
  tokens at connect time instead of carrying them in the cookie (would change the
  Lead Ads onboarding path that is under production observation) — instead the
  cookie became one AES-GCM envelope, which restores the original ~4 KB capacity.

Not verified — requires your Meta assets (see `submission.md` §4 checklist):
live reply on Facebook from the app; live Messenger receive/send via webhook;
Messenger error subcodes (Meta's error-code page returned HTTP 500 on
2026-09-14); Page-inbox echo `app_id`; insights with real delivery data; that
the Graph reply id equals the webhook `comment_id` format in production (tests
assume the documented shared id; confirm with the SQL in `submission.md`).

---

## 7. Integration and deploy order

1. Commit this work on `feat/meta-app-review` (not done — awaiting your go-ahead).
2. Bring in `origin/main` 662d7cac. Expected conflicts are mechanical, keeping
   both sides: `app/api/auth/facebook/route.ts` (analytics props become
   `{ origin, feature, inApp }`), `components/settings/FacebookConnect.tsx`,
   `components/settings/integrations/LeadSourcesSection.tsx`,
   `modules/settings/mobile/IntegrationsLanding.tsx`, `IntegrationsMobile.tsx`,
   `lib/connections/messages.ts` (keep `in_app_browser` and the spread of
   `META_FEATURE_NOTICES`). Re-run `tsc` and the suites above afterwards.
3. Confirm `SECRETS_ENC_KEY` in Vercel Production; apply the three migrations;
   deploy with all three `*_ENABLED` flags unset (no behaviour change except the
   token hygiene, comment Page-reply flagging and reconnect fix).
4. Enable for agency 103, then run `submission.md` §4 on production.
