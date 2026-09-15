# Meta App Review features — staged rollout runbook

Written for the operator who deploys `feat/meta-app-review`. Every step names
the exact command or setting and how to verify it. Nothing here has been run
against production. Stop at any failed verification; §8 is the way back.

**Never print a secret.** Environment checks below are by name/presence only.
Scripts in this runbook print counts and row ids only.

---

## 0. Facts at the time of writing (2026-09-15)

| Item | State | How known |
| --- | --- | --- |
| `origin/main` | `ac0b2b0d` (PR #53); branch has it merged | `git fetch` |
| Latest Vercel production deployment | created 2026-09-15 00:44 IDT; **commit not confirmed** | `vercel ls --prod` (the CLI did not show a SHA) — confirm in the Vercel dashboard or API before §2 |
| Production env names present | `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `SECRETS_ENC_KEY`, `JWT_SECRET`, `DATABASE_URL`, `CRON_SECRET`, `NEXT_PUBLIC_BASE_URL`, `FACEBOOK_COMMENTS_ENABLED`, `FACEBOOK_COMMENTS_AGENCY_ALLOWLIST` | `vercel env ls production`, names only |
| Production env names absent | `FACEBOOK_COMMENT_REPLIES_*`, `FACEBOOK_MESSENGER_*`, `FACEBOOK_ADS_REPORTING_*` (so all three features are OFF), `AUTOMATION_API_KEY` (fine: cron auth falls back to `CRON_SECRET`) | same |
| `SECRETS_ENC_KEY` shape in production | **not verifiable by name** — verified by §4.3 `--verify` and a successful connect in §3.4 | — |

---

## 1. Flags (absence-blocks: a feature is on for an agency only when its `*_ENABLED` is exactly `1` AND its allowlist names the agency or is `all`)

| Feature | Flag | Allowlist | Also requires |
| --- | --- | --- | --- |
| Comments inbox (existing) | `FACEBOOK_COMMENTS_ENABLED` | `FACEBOOK_COMMENTS_AGENCY_ALLOWLIST` | — |
| Reply to comments (new) | `FACEBOOK_COMMENT_REPLIES_ENABLED` | `FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST` | comments flag for the agency + `pages_manage_engagement` recorded on the Page |
| Messenger (new) | `FACEBOOK_MESSENGER_ENABLED` | `FACEBOOK_MESSENGER_AGENCY_ALLOWLIST` | `pages_messaging` recorded on the Page; Page subscribed to `messages,message_echoes` |
| Ad reporting (new) | `FACEBOOK_ADS_REPORTING_ENABLED` | `FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST` | agency admin; that user's `ads_read` connection |

Env changes on Vercel take effect on the next deployment: set, then redeploy.

---

## 2. Pre-deploy checks (read-only)

1. PR reviewed and merged into `main` through GitHub. The `schema.yml` workflow
   (fresh DB from baseline + all migrations, reversibility) is green.
2. Confirm the currently deployed production commit in the Vercel dashboard/API
   and that it is an ancestor of the merge (release-deployment-workflow §5).
3. Env names (never values):
   ```sh
   vercel env ls production | awk '{print $1}' | grep -E '^(META_APP_ID|META_APP_SECRET|META_REDIRECT_URI|META_VERIFY_TOKEN|SECRETS_ENC_KEY|JWT_SECRET|DATABASE_URL|CRON_SECRET|AUTOMATION_API_KEY)$'
   ```
   All must be listed except one of `CRON_SECRET` / `AUTOMATION_API_KEY`.
4. Migration list against production (read-only):
   ```sh
   npx knex --knexfile knexfile.cjs migrate:list
   ```
   Pending must be **exactly**:
   `20260914000001_facebook_page_comments_page_replies.cjs`,
   `20260914000002_create_messenger_tables.cjs`,
   `20260914000003_create_facebook_ad_connections.cjs`,
   `20260915000001_create_messenger_webhook_events.cjs`.
   Anything else pending → stop. Also run the contract check from
   release-deployment-workflow §8b (`20240101000000_create_users.cjs` recorded).

### Migration compatibility with the deployed build (verified locally)

All four are additive: two defaulted/nullable columns on `facebook_page_comments`
(plus a backfill of the new column only, and two indexes) and five new tables.
Verified on Postgres 18: the build at `origin/main` 662d7cac, running against a
database with these migrations applied, still connects Pages with plaintext
tokens, ingests/dedupes/lists/deletes comments, and its own DB test suites give
the same results as without the migrations. So migrations can be applied before
the deploy, and the previous build keeps working if the deploy is delayed.

---

## 3. Deploy with every new flag unset

1. Apply migrations (release-deployment-workflow §8b): `npm run migrate` against
   production. Record the four filenames in the deploy report.
2. Deploy `main` (the merge). Do **not** set any new flag yet.
3. What changes even with flags unset — know it before verifying:
   - New Page connections and reconnections store the token sealed; tokens no
     longer reach the browser; the connect route takes only a Page id.
   - A reconnect by the admin who connected a Page refreshes its token server-side.
   - For agencies with comments enabled: the Page's own comments are hidden from
     the work list and never alert (existing rows backfilled by migration 1).
   - `/api/cron/messenger-events` runs every minute; with Messenger off it finds
     nothing and returns counts of zero.
   - Lead Ads webhook handling is unchanged for deliveries without Messenger events.
4. Verify:
   - Meta Lead Ads Testing Tool: a test lead for a connected test Page arrives.
   - `select health_status, count(*) from facebook_pages group by 1;` — no jump
     in `token_expired` compared with before the deploy.
   - `select count(*) from webhook_failures where created_at > now() - interval '30 minutes';` — no new failures.
   - Reconnect one internal Page (agency 103) from Settings → Integrations →
     Facebook: success notice; then
     `select left(page_access_token, 5) = 'scm1.' as sealed from facebook_pages where agency_id = 103;`
     is `true` (this also proves production `SECRETS_ENC_KEY` works).
   - Cron: Vercel → Logs for `/api/cron/messenger-events` show 200.

---

## 4. Seal the existing plaintext Page tokens (only after §3 verified)

The previous build cannot read sealed tokens. Never run `--apply` while it could
still be serving traffic.

Run from a trusted machine with production `DATABASE_URL` and the **same**
`SECRETS_ENC_KEY` as Vercel, held in an env file that is not committed:

```sh
ENV_FILE=<secure prod env file> node scripts/seal_facebook_page_tokens.cjs            # dry run: counts
ENV_FILE=<secure prod env file> node scripts/seal_facebook_page_tokens.cjs --apply    # seal
ENV_FILE=<secure prod env file> node scripts/seal_facebook_page_tokens.cjs --verify   # must exit 0
```

1. Dry run prints `total / sealed / plaintext`. Record the numbers.
2. `--apply` prints `sealed=… changed_concurrently=… failed=0 plaintext_remaining=0`.
   Non-zero `changed_concurrently` means a Page was reconnected meanwhile
   (already sealed by the app) — re-run `--apply`; it is idempotent.
3. `--verify` must print `plaintext=0 unreadable_seals=0` and exit 0.
   `unreadable_seals>0` means this machine's key differs from production's — stop
   and fix the env file; do not deploy anything.
4. Watch §3.4's health and Lead Ads checks again for 30 minutes.

---

## 5. Enable agency 103 (internal), one feature at a time

For each flag: `vercel env add <NAME> production` and enter the value when
prompted (it is not echoed back); if the name exists, `vercel env rm` and re-add,
or edit it in the dashboard. Then redeploy. Confirm with
`node scripts/check_meta_rollout_env.cjs --agency 103` wherever the runtime env is
available, or by the UI appearing for agency 103 only.

### 5a. Comment replies
1. `FACEBOOK_COMMENTS_AGENCY_ALLOWLIST` must already include 103 (check in the
   dashboard; append `,103` if not — do not replace existing ids).
2. Set `FACEBOOK_COMMENT_REPLIES_ENABLED=1`, `FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST=103`. Redeploy.
3. The agency 103 admin **who connected the Page**: Conversations → Comments →
   "אשר הרשאה להשבה לתגובות" → approve on Facebook → returns to Comments with
   "ההרשאה אושרה". (Another admin lands on the Page picker instead and must
   select the Page to finish; the grant is then recorded the same way.)
4. Live check (unresolved until done): reply to a test comment from the app; open
   "פתח את הפוסט בפייסבוק" and see the reply as the Page; after one minute
   `select "commentId", "authorIsPage", "sentByUserId" from facebook_page_comments where "pageId"='<test page>' order by id desc limit 3;`
   shows **one** row for the reply. Two rows = Graph reply id and webhook
   `comment_id` differ → disable replies (§8) and fix before continuing.

### 5b. Messenger
Messenger needs BOTH subscriptions. Either one missing means Meta sends nothing,
and the flag, the tab and a recorded grant all look fine (incident 2026-09-14:
app subscribed to `leadgen,feed` only, Page subscribed to `leadgen,feed` only).

1. Meta dashboard (app-level): Messenger product added; Webhooks → **Page** →
   `messages` and `message_echoes` subscribed, in addition to `leadgen` and
   `feed`. Do not change the callback URL. Verify it through the API, not the
   screen: `GET /{app-id}/subscriptions` (app token) → the `page` object lists
   all four fields.
2. Set `FACEBOOK_MESSENGER_ENABLED=1`, `FACEBOOK_MESSENGER_AGENCY_ALLOWLIST=103`. Redeploy.
   The flag does NOT re-subscribe any Page.
3. Page-level: `GET /{page-id}/subscribed_apps` (Page token, never printed) must
   list `leadgen,feed,messages,message_echoes` for our app. Three things get it
   there, all through the same field computation (grant recorded + rollout):
   - the agency admin who connected the Page authorizes Messenger
     (`/api/auth/facebook?feature=messenger`) — the callback re-subscribes it;
   - opening Conversations → Messenger while no conversation exists (checks and
     repairs, at most once per Page per 5 minutes; shows "חבר מחדש את הדף
     ל-Messenger" if Meta refuses);
   - the hourly connection-health sweep.
   Confirm the grant with
   `select granted_scopes ? 'pages_messaging' from facebook_pages where agency_id = 103;`.
4. Live checks (unresolved until done), from an app-Tester account only — never a
   real customer:
   - Send a message to the Page → within ~10 s it appears unread in the tab;
     `select status, outcome from messenger_webhook_events order by id desc limit 3;` → `processed / stored`.
   - Reply from the app → arrives in Messenger; one outbound row, `source='socialcrm'`,
     after the echo is processed.
   - Reply once from Meta Business Suite → one outbound row `source='page_inbox'`
     (if `other_app`, note the `app_id` and update `PAGE_INBOX_APP_IDS`).
   - A conversation older than 24 h shows the closed-window notice.
   - Lead Ads Testing Tool lead still arrives.

### 5c. Ad reporting
1. Set `FACEBOOK_ADS_REPORTING_ENABLED=1`, `FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST=103`. Redeploy.
2. Agency 103 admin: ביצועים → מודעות → "חבר חשבון מודעות" → approve `ads_read`.
3. Live check (unresolved until done): pick an account and a range **with spend**;
   totals and campaigns must match Ads Manager for the same account and dates. A
   range with no delivery must show "אין פעילות בטווח הזה", not an error.

---

## 6. Monitoring while enabled

- `select status, count(*) from messenger_webhook_events group by 1;` —
  `received` should drain to 0 within minutes; **`failed` > 0 needs action**:
  `node scripts/requeue_messenger_events.cjs failed` → fix cause →
  `node scripts/requeue_messenger_events.cjs requeue --ids … --apply`.
- Vercel logs: `[healthSweep][facebook] Meta app Page webhook subscription is missing
  Messenger fields` (hourly; the dashboard lost `messages`/`message_echoes` — fix in
  the Meta dashboard, no customer can),
  `[Messenger] events acknowledged without storing` (counts of events
  for an unknown Page or an agency outside the rollout),
  `[FacebookRepair] Re-subscribing … missing=messages,message_echoes`,
  `[Messenger] durable receipt FAILED` (the webhook answered 503;
  Meta will redeliver) and `[messenger-events] receipts in terminal failed state`.
- Meta sends "webhook failing" alerts after 15 min of failures and disables the
  app's webhooks after 1 h. If disabled: fix the cause, then re-subscribe the app
  in Webhooks → Page, and run the hourly health repair or reconnect Pages.

---

## 7. Moving beyond agency 103

After App Review approval only: add agencies to the allowlists one at a time,
repeating the relevant §5 live check per agency. `all` only after several
agencies ran a week without `failed` receipts.

---

## 8. Disable and roll back (without interrupting existing integrations)

| To stop | Do | Effect | Unaffected |
| --- | --- | --- | --- |
| Comment replies | Remove the agency from `FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST` (or unset the flag); redeploy | Reply form and prompt disappear; action refuses | Comment ingestion, list, "צור ליד", Lead Ads |
| Messenger | Remove the agency from `FACEBOOK_MESSENGER_AGENCY_ALLOWLIST` (or unset); redeploy | New Messenger events are acknowledged and not stored; queued receipts settle `ignored/not_enabled`; tab hidden; sending refused; stored conversations kept | Lead Ads, comments (same webhook, unchanged path) |
| Messenger deliveries entirely | Additionally, agency admin reconnects the Page (fields recomputed without Messenger) or remove `messages`/`message_echoes` from the app's webhook subscription | Meta stops sending Messenger events | as above |
| Ad reporting | Remove from `FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST`; redeploy. To delete stored access: `delete from facebook_ad_connections where "agencyId" = <id>;` | Route redirects; no Marketing API calls | everything else |
| The whole build | Vercel instant rollback to the previous production deployment | See below | — |

**Code rollback order — the one trap:** if §4 `--apply` has run, the previous
build cannot read sealed tokens. Before promoting the old deployment:

```sh
ENV_FILE=<secure prod env file> node scripts/seal_facebook_page_tokens.cjs --unseal --apply --confirm-writes-plaintext
```

then roll back, then check Lead Ads (§3.4). Pages connected or reconnected by
the new build are also sealed and are covered by the same command. Re-run §4 when
the new build is live again. Leave the migrations in place on rollback: they are
compatible with the previous build (§2), and rolling them back would delete
Messenger and ad connection data.

---

## 9. Compromised test tokens — a separate, coordinated step

Do this only when §3 is live and verified (the reconnect fix is required to
recover), and schedule it; it is not part of any deploy.

1. Identify, without re-exposing: in a server shell, `GET /debug_token` with an
   app access token for each exposed token → note `app_id`, `user_id`, scopes.
   Do not paste tokens into a browser, chat, ticket or screenshot again.
2. If the Facebook user is test-only (connected no production Page in SocialCRM):
   remove the app in that user's Facebook → Settings & privacy → Business
   integrations (or `DELETE /me/permissions` with that user's token). All that
   user's tokens for the app, and Page tokens derived from them, stop working.
   Production connections belong to other users and are unaffected.
3. If it is the same user who connected production Pages: announce a window;
   (a) invalidate (remove the app / change the password); (b) immediately reconnect
   each affected Page in SocialCRM → Settings → Integrations → Facebook as that
   admin (the refresh stores a new sealed token); (c) verify §3.4 for each Page;
   (d) inspect `webhook_failures` rows created during the window —
   `token_expired` rows are not retried automatically and must be resolved
   deliberately.
4. Revoking only individual permissions does not invalidate a leaked token.
5. Do not enable Settings → Advanced → "Require App Secret": older Lead Ads,
   WhatsApp and Conversions API calls do not send `appsecret_proof` yet.
