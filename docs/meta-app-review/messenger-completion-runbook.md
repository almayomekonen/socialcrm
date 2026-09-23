# Messenger completion — release runbook

Covers the `feat/messenger-complete` branch. Sits beside `rollout-runbook.md`,
which remains the source of truth for the original Meta App Review rollout
(sealing, per-agency flags, token revocation).

**Status of this branch: NOT production-ready.** Everything below is implemented
and covered by automated tests; none of it has been exercised against a real
Page, a real customer or a real Meta delivery. See *Live verification* — that
gate has not been passed.

---

## 1. What ships

Three migrations, all additive:

| Migration | What it does |
| --- | --- |
| `20260923000001_messenger_profiles_and_receipts` | Profile columns on `messenger_conversations`; `deliveredAt`/`readAt` on `messenger_messages`; new `messenger_events` table; **widens** `messenger_webhook_events.kind` CHECK |
| `20260923000002_messenger_history_import` | `historyImportedAt` on `messenger_conversations` |
| `20260923000003_messenger_saved_replies` | New `messenger_saved_replies` table |

Nothing is dropped, renamed or retyped. No existing column changes meaning.

---

## 2. Release order (do not reorder)

Migrations are applied **manually, before the deploy**, never by the build
(`release-deployment-workflow.md` §8b). `package.json`'s `build` stays plain
`next build`; `vercel.json` has no build override. Do not add one.

```
1. git push origin feat/messenger-complete        # preview only; no prod effect
2. Confirm what would run:
     npx knex --knexfile knexfile.cjs migrate:list      # against production DATABASE_URL
   Expect exactly the three migrations above as Pending.
   ⚠ This currently FAILS — see §2a.
3. npm run migrate                                 # against production DATABASE_URL
4. Record the applied filenames + the commit SHA in the deployment report.
5. Merge the PR → Vercel deploys main.
6. Meta App Dashboard → Webhooks → Page: add the five fields in §3.
7. Within the hour, the connection-health cron re-subscribes each Page (§4).
```

Use the **direct** Neon host for migrations, never `-pooler` (drop `-pooler`
from the hostname).

### 2a. Blocker: production is ahead of `main` (found 2026-09-23)

`knex_migrations` batch 48 records three billing migrations that exist ONLY on
the unmerged branch `feat/card-required-trial`:

```
20260916000001_create_billing_payment_methods.cjs
20260916000002_create_billing_charges.cjs
20260916000003_card_storage_consent.cjs
```

Their tables are live in production. Because those files are absent from `main`,
knex aborts with *"The migration directory is corrupt, the following files are
missing"* and **will not migrate production from this branch, or from main.**
That is knex's protection against a deleted migration; it cannot distinguish
that from "the files are on a branch nobody merged".

There is also a filename-number collision — `main` uses `20260916000001` and
`...002` for different migrations, and production records both pairs (batch 47
and batch 48). Do not author a new migration at that timestamp.

**The real fix is to merge `feat/card-required-trial`.** Note that it is 69
commits including auth, billing charges and marketing changes, so merging it is
a product deployment, not a schema tidy-up — it needs its own decision, not a
drive-by merge to unblock a migration.

**One-off workaround**, if Messenger must ship before that: run
`migrate.latest()` programmatically with `disableMigrationsListValidation: true`
and assert that the only pending migrations are the three `20260923*` ones. The
billing migrations cannot be re-run by this — `migrate:latest` only considers
files present in the directory. Do not commit that config; it steps around the
divergence rather than fixing it, and the next person hits the same wall.

**Why migrations first:** the code reads `deliveredAt`, `profileStatus`,
`historyImportedAt` and `messenger_saved_replies`. Deploying before migrating
throws 42703/42P01 in production — which is exactly what happened on 2026-09-14
and cost ~13 minutes of webhook failures.

**Why the dashboard step is separate and after:** subscribing the app to new
fields starts delivery immediately. Doing it before the code is live means
events arrive at a build that ignores them — harmless (they parse as `ignored`),
but pointless, and it muddies the first live verification.

---

## 3. Meta dashboard: the app-level half (REQUIRED)

Verified against the live app on 2026-09-23 via
`GET /{app-id}/subscriptions` with an app access token:

```
page object fields today: feed, leadgen, message_echoes, messages
```

The five new fields are **missing at the app level**:

```
message_deliveries     MISSING
message_reads          MISSING
messaging_postbacks    MISSING
messaging_referrals    MISSING
message_reactions      MISSING
```

Until they are ticked in **App Dashboard → Webhooks → Page**, Meta sends none of
them — no matter what each Page is subscribed to. Page-level subscription is the
other half, not a substitute. This is the same two-sided failure as the
2026-09-14 incident.

This was deliberately **not** changed from here: it is a production
configuration change to a live app, and it re-verifies the callback URL against
production.

After ticking them, `lib/connections/healthSweep.ts` stops emitting
`"Meta app is not subscribed to Messenger signal fields"`.

---

## 4. Page-level half — automatic, but verify

Each connected Page's own `subscribed_apps` must also list the fields. Nobody
needs to reconnect: `/api/cron/connection-health` runs hourly, compares each
Page against `pageWebhookFieldList(...)` and re-subscribes any that are missing
fields. Proven by `__tests__/connections/messengerFieldConvergence.test.ts`,
which drives the real repair path against a Page on the old field set.

Two conditions gate it, by design:

- the agency is in the Messenger rollout (`FACEBOOK_MESSENGER_ENABLED` +
  allowlist), and
- the Page's recorded grant contains `pages_messaging`.

A Page failing either keeps exactly `leadgen,feed`.

To check a specific Page after deploy:

```sql
SELECT page_id, health_checked_at FROM facebook_pages WHERE agency_id = <id>;
```

then confirm against Meta with the Page token
(`GET /{page-id}/subscribed_apps`). Do not read tokens into a terminal you do
not control.

**If Meta refuses one of the new fields**, repair backs off one tier at a time —
full set → `leadgen,feed,messages,message_echoes` → `leadgen,feed` — so a
rejected enhancement costs that enhancement, never core messaging and never Lead
Ads.

---

## 5. Environment

No new variables. The feature is gated by the existing
`FACEBOOK_MESSENGER_ENABLED` / `FACEBOOK_MESSENGER_AGENCY_ALLOWLIST`, which
production already sets.

Per `feature-rollout-standard`, note what is invisible without them: with the
flag off for an agency, the Messenger tab, the settings sections (entry points,
saved replies) and the unread badge all render nothing. That is intended, and it
is also the rollback switch (§6).

---

## 6. Rollback

**Preferred: turn the flag off.** Remove the agency from
`FACEBOOK_MESSENGER_AGENCY_ALLOWLIST`. Instant, no data loss, no schema change.
Inbound webhooks are then acknowledged and dropped as `not_enabled`, exactly as
before this branch. Do this first; it resolves almost everything.

**Code rollback (revert the deploy):** safe *without* rolling back the
migrations. Every schema change is additive, so the previous build ignores the
new columns and tables. Do not roll back migrations to match a code rollback —
that is strictly more dangerous than leaving them.

**Migration rollback** — only if the schema itself is implicated. All three
`down()` functions are implemented and were verified to roll back and re-apply
cleanly against the test database. Read these before running one:

- `20260923000001` down **DELETEs `messenger_webhook_events` rows whose `kind`
  is not `inbound`/`echo`** before restoring the narrower CHECK. Those are
  already-processed receipts and nothing reads them afterwards — but it is a
  delete, and it is not reversible.
- `20260923000001` down drops `deliveredAt`/`readAt` and the whole
  `messenger_events` table: every delivery receipt, postback, referral and
  reaction is **lost**. Messages themselves are untouched.
- `20260923000003` down drops `messenger_saved_replies` — every snippet the
  agency wrote is **lost**. Export first if that matters:
  `COPY (SELECT * FROM messenger_saved_replies) TO STDOUT WITH CSV HEADER;`
- `20260923000002` down drops `historyImportedAt`; a later re-import is then
  offered again. Harmless.

**What has no rollback:** messages already delivered to a customer. Nothing in
this branch sends without an explicit human action, so there is no automated
send to stop — but the persistent menu and greeting, once saved, are live on the
Page until an admin clears them (Settings → הודעת פתיחה ותפריט ב-Messenger,
empty the fields, save).

---

## 7. Live verification — NOT DONE

No part of this has touched a real Page. To close that gap, the minimum is:

1. **A Facebook Page** you control, with a test/staff Facebook account able to
   message it. A brand-new Page is fine and safest.
2. **Connect it through the product**, at Settings → מקורות לידים → פייסבוק →
   connect, granting Messenger when asked. Use the normal OAuth flow — no token
   ever needs to be pasted anywhere.
3. **Confirm the app is in Live mode** (App Dashboard). In Development mode only
   people with a role on the app can interact, so a genuine customer test is not
   possible.
4. From the test account, **send the Page a message**. It should appear in
   שיחות → Messenger within seconds.
5. **Reply from SocialCRM.** Confirm it arrives in Messenger.
6. Send an **image and a PDF** from the customer side; send one back from
   SocialCRM.
7. Tap a **persistent menu item** (after configuring one) and confirm the
   "בחר: …" line appears in the thread.
8. **React** to a Page message and confirm the emoji appears on that bubble.
9. Leave the conversation **25 hours**, then confirm the composer is replaced by
   the window-closed notice.

Only after 4–6 succeed against a real Page should any part of this be described
as working. Until then: implemented and automatically tested, not verified.

---

## 8. Known external blocker

**Business Asset User Profile Access** is not granted. Confirmed 2026-09-23:
`GET /{app-id}/permissions` returns ten `live` permissions and does not include
it (it is a *Feature*, which that endpoint does not enumerate, so this is
consistent with "not granted" rather than proof — the definitive check is App
Dashboard → App Review → Permissions and Features).

Consequence: customer names and profile pictures are unavailable, contacts show
initials, and an admin-only line says why. **Messaging is unaffected.** See
`docs/meta-app-review/business-asset-user-profile-access.md` for the submission
text and the screencast checklist.
