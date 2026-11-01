# Security Phase 1 — environment isolation (Preview vs Production)

Status: **investigation and plan only.** Nothing has been changed. Every step in
§6 needs its own approval and is run one at a time.

Evidence base (2026-11-01, read-only):

- code on `main` at `14addfae`, the commit Production serves;
- `vercel env ls`, names and scopes only;
- project and deployment metadata from the Vercel API.

No secret value was read, printed, hashed or fingerprinted.

This replaces Phase 1 of `docs/secrets-enc-key-execution-checklist.md` and
corrects it where the two differ: see §8.

---

## 1. What the investigation found

1. **Preview deployments are public and run with production secrets.**
   - The project has no Deployment Protection: `ssoProtection` and
     `passwordProtection` are both null, with one protection-bypass entry.
   - More than 100 Ready Preview deployments exist (the first API page alone
     goes back to 2026-10-05).
   - Each one holds `JWT_SECRET`, `SECRETS_ENC_KEY`, `CRON_SECRET`,
     `META_APP_SECRET`, the Google client secrets and `RESEND`, against
     `preview-shared`, a copy of production data.
   - Vercel bakes variables into each deployment, so **changing a variable
     does not remove it from deployments that already exist.**
2. **`JWT_SECRET` is shared by Production, Preview and Development.** It is the
   HS256 key that signs session cookies (`db/auth.ts:100–109`; also
   `lib/auth/fbLoginProof.ts:21–24`). Anyone who can read it from any Preview
   build can mint a valid production session for any user. This is the
   authentication area (do-not-touch): **listed here, not planned here** — see §7.
3. **Platform email unsubscribe links are signed with `CRON_SECRET`.**
   `UNSUBSCRIBE_SECRET` is unset in every environment, so
   `lib/emailAutomations/unsubscribeToken.ts:5–7` falls back to `CRON_SECRET`.
   The link is built at `lib/emailAutomations/config.ts:11` and verified at
   `app/api/email/unsubscribe/route.ts:16`. **Rotating `CRON_SECRET` would
   break every unsubscribe link already in recipients' inboxes.** This blocks
   rotation, not scope separation.
4. **Grow secrets: the old ones are dead, not active.** `GROW_TOKEN_SECRET`,
   `GROW_WEBHOOK_SECRET`, `GROW_RECURRING_WEBHOOK_SECRET`,
   `GROW_RECURRING_FAILURE_WEBHOOK_SECRET`, `GROW_PAYMENT_LINK` and
   `GROW_PAYMENT_LINK_ANNUAL` have no reader on `main`. They were removed in
   `7656ed4c` (2026-09-16, "remove Payment Links"), and `/api/payments/grow`
   returns 404 in Production. The live callback `/api/payments/grow/notify` has
   no shared secret by design (`app/api/payments/grow/notify/route.ts:10–25`).
   These need **deleting**, not rotating.
5. **`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` are orphans.** No reader since
   `6b8fe4ae` (2026-03-21, renamed to `META_APP_*`). `META_PAGE_ID` has no
   reader either. Integrations use `META_APP_*`; user login uses a separate
   `AUTH_FACEBOOK_APP_ID` / `AUTH_FACEBOOK_APP_SECRET`, which is auth (§7).
6. **Nothing stops a Preview from sending real messages.** WhatsApp, Messenger
   and email sends have no `VERCEL_ENV` guard. A Preview can open the copied
   agency tokens (shared `SECRETS_ENC_KEY`) and those tokens need no app
   secret, so removing Meta secrets from Preview does **not** stop sends; only
   splitting `SECRETS_ENC_KEY` (or scrubbing `preview-shared`) does.
   - Payments are guarded: real money needs `VERCEL_ENV=production`
     (`lib/payments/grow/config.ts:46–61`).
   - The Pixel and the Conversions API are guarded: `lib/facebook/pixelEnv.ts:25`,
     checked at `conversionsApi.ts:99`.
7. **Vercel Cron runs only on the Production deployment.** Preview has no
   automatic `CRON_SECRET` caller; it needs a value only for manual testing.

---

## 2. Inventory

### 2.1 `CRON_SECRET`

**15 Vercel crons** (`vercel.json`). Vercel sends `Authorization: Bearer
<CRON_SECRET>`, Production only.

| schedule       | route                              | auth                                        | secret read at                                    |
| -------------- | ---------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `0 6 * * *`    | `/api/cron/analyze-conversations`  | `CRON_SECRET ?? CONVERSATION_WORKER_SECRET` | `app/api/cron/analyze-conversations/route.ts:15`  |
| `0 * * * *`    | `/api/cron/email-automations`      | `getAutomationSecret()`                     | `app/api/cron/email-automations/route.ts:10`      |
| `0 */6 * * *`  | `/api/cron/whatsapp-template-sync` | `CRON_SECRET`                               | `app/api/cron/whatsapp-template-sync/route.ts:23` |
| `*/5 * * * *`  | `/api/cron/automations-dispatch`   | `CRON_SECRET`                               | `app/api/cron/automations-dispatch/route.ts:28`   |
| `*/1 * * * *`  | `/api/cron/notifications-dispatch` | `CRON_SECRET`                               | `app/api/cron/notifications-dispatch/route.ts:46` |
| `*/1 * * * *`  | `/api/cron/send-auto-responses`    | `getAutomationSecret()`                     | `app/api/cron/send-auto-responses/route.ts:20`    |
| `*/1 * * * *`  | `/api/cron/signal-sweep`           | `getAutomationSecret()`                     | `app/api/cron/signal-sweep/route.ts:29`           |
| `*/15 * * * *` | `/api/cron/retry-webhook-failures` | `CRON_SECRET`                               | `app/api/cron/retry-webhook-failures/route.ts:29` |
| `0 * * * *`    | `/api/cron/connection-health`      | `CRON_SECRET`                               | `app/api/cron/connection-health/route.ts:29`      |
| `*/5 * * * *`  | `/api/cron/history-import`         | `getAutomationSecret()`                     | `app/api/cron/history-import/route.ts:43`         |
| `*/1 * * * *`  | `/api/cron/messenger-events`       | `getAutomationSecret()`                     | `app/api/cron/messenger-events/route.ts:21`       |
| `*/5 * * * *`  | `/api/cron/subscription-charges`   | `CRON_SECRET`                               | `app/api/cron/subscription-charges/route.ts:35`   |
| `17 3 * * *`   | `/api/cron/oauth-sweep`            | `CRON_SECRET`                               | `app/api/cron/oauth-sweep/route.ts:25`            |
| `*/1 * * * *`  | `/api/cron/owner-wa-reminders`     | `CRON_SECRET`                               | `app/api/cron/owner-wa-reminders/route.ts:19`     |
| `*/1 * * * *`  | `/api/cron/wa-assistant`           | `CRON_SECRET`                               | `app/api/cron/wa-assistant/route.ts:22`           |

`getAutomationSecret()` is `AUTOMATION_API_KEY ?? CRON_SECRET`
(`lib/automation/apiAuth.ts:12–14`). It accepts the secret in
`Authorization: Bearer`, `x-automation-key` or `x-cron-secret`
(`apiAuth.ts:16–21`).

**4 routes with no cron**, for manual or external callers:

| route                                         | auth                    | read at                                                      | documented caller                                                                                                        |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `/api/internal/owner-wa/readiness`            | `CRON_SECRET`           | `app/api/internal/owner-wa/readiness/route.ts:20`            | operator `curl` — `docs/owner-whatsapp-reminders-rollout.md:103`, `docs/wa-assistant-readiness.md:10`                    |
| `/api/internal/owner-wa/one-off-send`         | `CRON_SECRET`           | `app/api/internal/owner-wa/one-off-send/route.ts:33`         | operator — `docs/owner-whatsapp-reminders-rollout.md:136,173` (session alternative: `actions/admin/ownerWaOneOff.ts:10`) |
| `/api/runtime/coverage-sweep`                 | `getAutomationSecret()` | `app/api/runtime/coverage-sweep/route.ts:20`                 | **none documented**                                                                                                      |
| `/api/admin/announcements/whatsapp-templates` | `getAutomationSecret()` | `app/api/admin/announcements/whatsapp-templates/route.ts:17` | **none documented**                                                                                                      |

**Non-auth consumer:**
`lib/emailAutomations/unsubscribeToken.ts:6`, the platform unsubscribe HMAC
(finding 3). The engine's lead unsubscribe token deliberately does **not** fall
back to it (`lib/automations/unsubscribeToken.ts:11–15`).

**Tooling:** `scripts/check_meta_rollout_env.cjs:27` checks that one of
`AUTOMATION_API_KEY` / `CRON_SECRET` is present.

**Callers by credential:**

| caller                                                      | environment     | needs                                                                                                                           |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Cron (15 routes)                                     | Production only | the Production value, automatically, after redeploy                                                                             |
| operators running the two `/api/internal/owner-wa/*` routes | Production      | must hold the Production value. Who holds it today is **unknown**                                                               |
| `coverage-sweep`, `announcements/whatsapp-templates`        | unknown         | the `apiAuth.ts:4` comment names "n8n, schedulers, workers". **Ask the owner** whether n8n or any external scheduler calls them |
| unsubscribe links in sent emails                            | Production      | the value _at the time each email was sent_                                                                                     |
| Preview                                                     | —               | no automatic caller; a separate value for manual testing only                                                                   |
| CI (`.github/workflows/schema.yml`)                         | —               | does not use it                                                                                                                 |

**Undocumented dependencies that could break:**

1. Unsubscribe links (finding 3). The Vercel value is marked sensitive and
   cannot be read back. Moving it to `UNSUBSCRIBE_SECRET` therefore needs
   either a person who already holds the value, or a code change that verifies
   against both secrets.
2. **Setting `AUTOMATION_API_KEY` later would break 5 crons.** The five
   `getAutomationSecret()` crons would then expect that key, but Vercel Cron
   keeps sending `CRON_SECRET`. Keep it unset, or change the helper to accept
   either before setting it.
3. `CONVERSATION_WORKER_SECRET` (unset) is only a fallback; harmless while
   `CRON_SECRET` exists.
4. Hard-coded fallbacks:
   - `'dev-unsubscribe-secret'` (`emailAutomations/unsubscribeToken.ts:7`) and
     `'dev-automations-unsubscribe-secret'` (`automations/unsubscribeToken.ts:15`).
   - In an environment with neither variable set, unsubscribe tokens can be
     forged. Production has `CRON_SECRET` and `AUTOMATIONS_UNSUBSCRIBE_SECRET`,
     so it is not affected today, but **removing `CRON_SECRET` from Preview
     without a replacement drops Preview to the hard-coded string.** Every
     scope split below adds a Preview value in the same step.

### 2.2 `SECRETS_ENC_KEY`

- **Readers:**
  - `lib/crypto/secrets.ts:17–21`: encrypt, decrypt and the HKDF subkeys at
    `:52–58`;
  - `scripts/resolvePageToken.cjs:14–17`;
  - `scripts/check_meta_rollout_env.cjs:23,50–51`, which checks the shape only.
- **Failure logs** that name it: `app/api/auth/facebook/connect/route.ts:65`,
  `app/api/facebook/status/route.ts:51`, `lib/facebook/finishPageOAuth.ts:83`.
- **Full data map:** `docs/secrets-enc-key-security-plan.md` §1. HMAC users are
  at `lib/whatsapp/platform/keys.ts:16–20`.
- **Vercel:** one `Preview, Production` entry (161 days old), plus a
  branch-scoped Preview entry for `feat/card-required-trial`.

### 2.3 Grow

**Read by code:**

| variables                                           | reader                                | Vercel scope                                                                        |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `GROW_MODE`, `GROW_USER_ID`, `GROW_PAGE_CODE_TOKEN` | `lib/payments/grow/*` (11 reads each) | Production, plus branch Previews `design/billing-ui` and `feat/card-required-trial` |
| `GROW_SANDBOX_ISOLATED_DATA`                        | Grow code                             | branch Previews only                                                                |

**Not read by code** (orphans; see finding 4):

| variable                                | Vercel scope        |
| --------------------------------------- | ------------------- |
| `GROW_TOKEN_SECRET`                     | Preview, Production |
| `GROW_WEBHOOK_SECRET`                   | Preview, Production |
| `GROW_PAYMENT_LINK`                     | Preview, Production |
| `GROW_PAYMENT_LINK_ANNUAL`              | Preview, Production |
| `GROW_RECURRING_WEBHOOK_SECRET`         | Production          |
| `GROW_RECURRING_FAILURE_WEBHOOK_SECRET` | Production          |

### 2.4 Meta

Scope abbreviations: P = Production, Pr = Preview, D = Development.

| variable                                           | scope    | read at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | used for                                                       |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `META_APP_ID`                                      | D, Pr, P | `app/api/auth/facebook/route.ts:75,90`; `auth/facebook/ads/route.ts:37`; `auth/facebook/callback/route.ts:85`; `auth/whatsapp/route.ts:34`; `whatsapp/embedded-signup/route.ts:75`; `whatsapp/callback/route.ts:38`; `lib/facebook/health.ts:52`; `appWebhookSubscription.ts:16,48`; `messenger/ingestMessengerEvent.ts:127`; `pageDiscoveryDiagnostics.ts:171`; `ads/handleAdsOAuthCallback.ts:47`; `lib/whatsapp/resolveWaba.ts:21`; `platform/readiness.ts:63`; `platform/agentReadiness.ts:73`; `components/settings/integrations/LeadSourcesSection.tsx:170` (browser) | OAuth dialogs, app token, Embedded Signup SDK                  |
| `META_APP_SECRET`                                  | D, Pr, P | `auth/facebook/callback/route.ts:86`; `webhooks/whatsapp/route.ts:30`; `webhooks/facebook/route.ts:239`; `whatsapp/embedded-signup/route.ts:76`; `whatsapp/callback/route.ts:39`; `pageDiscoveryDiagnostics.ts:172`; `graphClient.ts:63`; `appWebhookSubscription.ts:17,49`; `ads/handleAdsOAuthCallback.ts:48`; `resolveWaba.ts:22`; `platform/readiness.ts:64`                                                                                                                                                                                                            | code exchange, webhook signature, `appsecret_proof`, app token |
| `META_REDIRECT_URI`                                | P, Pr, D | `auth/facebook/route.ts:76,92`; `auth/facebook/ads/route.ts:38`; `auth/facebook/callback/route.ts:87`; `ads/handleAdsOAuthCallback.ts:49`                                                                                                                                                                                                                                                                                                                                                                                                                                   | OAuth redirect (one value for every environment)               |
| `META_VERIFY_TOKEN`                                | D, Pr, P | `webhooks/facebook/route.ts:32`; `webhooks/whatsapp/route.ts:21`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | webhook subscription handshake                                 |
| `META_CAPI_ACCESS_TOKEN`                           | Pr, P    | `lib/facebook/conversionsApi.ts:66`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Conversions API, Production-gated                              |
| `META_EMBEDDED_SIGNUP_CONFIGURATION_ID`            | Pr, P    | `LeadSourcesSection.tsx:171`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Embedded Signup                                                |
| `META_GRAPH_VERSION`                               | Pr, P    | `lib/facebook/graph.ts:1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | not a secret                                                   |
| `META_PAGE_ID`                                     | P, Pr, D | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **orphan**                                                     |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`           | P, Pr, D | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **orphans** (since 2026-03-21)                                 |
| `AUTH_FACEBOOK_APP_ID`, `AUTH_FACEBOOK_APP_SECRET` | Pr, P    | `lib/auth/verifyFacebookAccessToken.ts:36–37`; `verifyFacebookLimitedLogin.ts:75`; three login pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **user login (auth area, §7)**                                 |
| `PLATFORM_WHATSAPP_*`                              | P only   | `lib/flags/ownerWhatsappReminderFlags.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | already isolated                                               |

### 2.5 Google

| variable                                                                                                      | scope        | read at                                                                                                                               | used for                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`                                                     | Pr, P        | `app/api/auth/google-calendar/route.ts:33`; `google-calendar/callback/route.ts:63–65`; `lib/integrations/google/calendarTokens.ts:43` | connect, code exchange, **token refresh**                                                          |
| `GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`                                                        | Pr, P        | `app/api/auth/google-drive/route.ts:28`; `google-drive/callback/route.ts:63–64`; `lib/integrations/google/driveTokens.ts:51`          | connect, code exchange, **token refresh**                                                          |
| `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`, `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` | Pr, P        | `lib/integrations/google/picker/pickerCore.ts:22`                                                                                     | browser Picker. Public by nature; protection is the API key's referrer restriction in Google Cloud |
| `NEXT_PUBLIC_GGLID`, `MOBILE_GOOGLE_*_CLIENT_ID`                                                              | P, Pr, D / P | `actions/auth.ts`, `lib/mobile/google.ts`                                                                                             | user sign-in (public ids, auth area)                                                               |

---

## 3. Preview flows that use Production Meta/Google credentials today

| flow                                                             | where                                                                                                       | what Preview does with production credentials                                                                                                                                                                                        | needed in Preview?           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Facebook Page / Ads connect                                      | start `auth/facebook/route.ts:75–92`, callback `callback/route.ts:85–87`                                    | builds the dialog with the production app. The redirect is the single shared `META_REDIRECT_URI`, so the callback runs wherever that points (**inferred: Production**; confirm in Meta → Facebook Login → Valid OAuth Redirect URIs) | only with a Preview test app |
| WhatsApp Embedded Signup                                         | browser `LeadSourcesSection.tsx:170–171` → `whatsapp/embedded-signup/route.ts:75–76` on the Preview origin  | if Meta allows the Preview origin, it exchanges the code with the production secret and stores a real WABA in `preview-shared`                                                                                                       | only with a Preview test app |
| WhatsApp/Messenger webhooks                                      | `webhooks/*/route.ts`                                                                                       | Meta delivers to the Production URL only, so it isn't exercised                                                                                                                                                                      | no                           |
| Graph calls with copied tokens                                   | `graphClient.ts:63` (proof), `resolveWaba.ts:21–22`, `pageDiscoveryDiagnostics.ts:171–172`, every send path | real calls to Meta on behalf of real agencies. **Sends need no app secret**                                                                                                                                                          | no                           |
| Google connect                                                   | `google-*/route.ts`, `google-*/callback/route.ts`                                                           | redirect is the shared `GOOGLE_*_REDIRECT_URI`, so the callback runs where it points (**inferred: Production**; Google accepts only registered URIs)                                                                                 | only with a test client      |
| Google token refresh                                             | `calendarTokens.ts:43`, `driveTokens.ts:51`                                                                 | **refreshes copied production refresh tokens with the production client secret**, which gives real access to customers' Calendar and Drive                                                                                           | no                           |
| Conversions API                                                  | `conversionsApi.ts:66`                                                                                      | gated off outside Production                                                                                                                                                                                                         | no                           |
| Crons using Meta (`connection-health`, `whatsapp-template-sync`) | —                                                                                                           | Production only                                                                                                                                                                                                                      | no                           |

**Test credentials needed before removing production values from Preview**
(only if Preview must keep working integrations):

- **Meta test app.** Meta lets an app have child _test apps_, each with its
  own id and secret. Configure on it:
  - Facebook Login for Business with the redirect URI;
  - an Embedded Signup configuration;
  - a webhook verify token;
  - **a stable Preview hostname** registered as a redirect URI and allowed
    domain. Per-branch Preview URLs cannot be registered, so this needs a
    fixed alias (for example a `preview.` subdomain assigned to one branch).
- **Google test OAuth client(s)** in a separate Google Cloud project:
  - the consent screen in Testing mode, with named test users;
  - redirect URIs on the same stable Preview hostname;
  - a Picker API key restricted to that host.
- **Grow:** nothing. Default Preview already has no merchant credentials;
  sandbox values exist for two branches.

Without these, Preview simply has no Meta or Google integrations. Interactive
connect almost certainly does not complete on a Preview today anyway, because
the redirect URIs are shared. **Recommended:** accept that for now (§6, step 6)
and add test apps only if Preview testing of integrations is needed.

---

## 4. Vercel change table

Scopes: P = Production, Pr = Preview, D = Development, Pr(b) = branch-scoped
Preview. "Keep" means the Production value is untouched. Narrowing an entry's
environments in Vercel does not require knowing its value.

| #   | variable / setting                                                                                                                                                                                              | current                                           | required P                                                                                                                   | required Pr                                                          | rotate?                                                                                                            | dependencies and verification                                                                                                                                                                                                                                              | rollback                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A   | **Deployment Protection** (project setting)                                                                                                                                                                     | off                                               | production domain unaffected                                                                                                 | Vercel Authentication on Preview and generated URLs                  | —                                                                                                                  | First check what the one existing bypass entry is for (e2e, monitoring?). Verify: a Preview URL opened logged-out gets the Vercel login; `getsocialcrm.com`, Meta and Grow callbacks and crons are unaffected (all use the production domain)                              | turn the setting off                              |
| B   | **existing Preview deployments**                                                                                                                                                                                | >100 Ready, each with production secrets baked in | —                                                                                                                            | delete, or rely on A                                                 | —                                                                                                                  | after A, list them; delete old ones in batches, never Production deployments                                                                                                                                                                                               | none needed (Previews rebuild on the next push)   |
| C   | `CRON_SECRET`                                                                                                                                                                                                   | P+Pr; Pr(b) `feat/card-required-trial`            | keep                                                                                                                         | own new value (the same step adds it)                                | **not yet** — blocked by C2                                                                                        | Verify: the next minute's cron runs log success (Production unchanged); `vercel env ls` shows no P+Pr row                                                                                                                                                                  | re-add Preview to the entry                       |
| C2  | `UNSUBSCRIBE_SECRET`                                                                                                                                                                                            | unset                                             | must equal the value unsubscribe links were signed with, i.e. the current `CRON_SECRET`, **or** a code change verifying both | own value                                                            | —                                                                                                                  | **Precondition for any `CRON_SECRET` rotation.** Needs whoever holds the current value, or the dual-verify code change. Verify: an old unsubscribe link (from a test inbox) still unsubscribes                                                                             | remove the variable (falls back to `CRON_SECRET`) |
| C3  | `AUTOMATION_API_KEY`, `CONVERSATION_WORKER_SECRET`                                                                                                                                                              | unset                                             | **keep unset**                                                                                                               | unset                                                                | —                                                                                                                  | Setting `AUTOMATION_API_KEY` breaks 5 crons (§2.1)                                                                                                                                                                                                                         | —                                                 |
| D   | `SECRETS_ENC_KEY`                                                                                                                                                                                               | P+Pr; Pr(b)                                       | keep                                                                                                                         | own new key                                                          | no (Production rotation is the keyring plan)                                                                       | Effect: Preview can no longer open copied tokens, so Preview sends, refreshes and connection status fail — the intended isolation. Preview hashes change (Preview only). Verify: Production Facebook status, a Drive read and a WhatsApp send for a test agency still work | re-add Preview to the entry                       |
| E   | `META_APP_SECRET`, `META_APP_ID`                                                                                                                                                                                | D+Pr+P                                            | keep                                                                                                                         | test app's values, or none                                           | later (checklist Phase 4)                                                                                          | Remove Development too (local uses `.env.local`). Verify: Production Facebook connect, Embedded Signup start, webhook signature checks (no 401s in logs)                                                                                                                   | re-add scopes                                     |
| F   | `META_REDIRECT_URI`, `META_VERIFY_TOKEN`, `META_EMBEDDED_SIGNUP_CONFIGURATION_ID`                                                                                                                               | D+Pr+P / Pr+P                                     | keep                                                                                                                         | test app's values, or none                                           | `META_VERIFY_TOKEN`: optional, low value                                                                           | Verify: Production webhook handshake not needed again; connect still works                                                                                                                                                                                                 | re-add scopes                                     |
| G   | `META_CAPI_ACCESS_TOKEN`                                                                                                                                                                                        | Pr+P                                              | keep                                                                                                                         | none (gated off anyway)                                              | optional                                                                                                           | Verify: Production CAPI events still arrive (Events Manager)                                                                                                                                                                                                               | re-add Preview                                    |
| H   | `META_PAGE_ID`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`                                                                                                                                                        | P+Pr+D                                            | **delete**                                                                                                                   | delete                                                               | no                                                                                                                 | No reader on `main` (re-run the grep just before). Verify: the build passes; no "not set" log lines                                                                                                                                                                        | re-create from the secret manager                 |
| I   | `GOOGLE_CALENDAR_CLIENT_*`, `GOOGLE_DRIVE_CLIENT_*` (id, secret, redirect)                                                                                                                                      | Pr+P                                              | keep                                                                                                                         | test client, or none                                                 | later (checklist Phase 6)                                                                                          | Verify: Production token refresh (`calendarTokens.ts:43`, `driveTokens.ts:51`) works for a test user; Preview refresh fails                                                                                                                                                | re-add Preview                                    |
| J   | `NEXT_PUBLIC_GOOGLE_*`                                                                                                                                                                                          | Pr+P                                              | keep                                                                                                                         | keep or test                                                         | no                                                                                                                 | **[EXT]** confirm the Picker API key's HTTP-referrer restriction in Google Cloud                                                                                                                                                                                           | —                                                 |
| K   | `GROW_TOKEN_SECRET`, `GROW_WEBHOOK_SECRET`, `GROW_RECURRING_WEBHOOK_SECRET`, `GROW_RECURRING_FAILURE_WEBHOOK_SECRET`, `GROW_PAYMENT_LINK`, `GROW_PAYMENT_LINK_ANNUAL`                                           | P+Pr / P                                          | **delete**                                                                                                                   | delete                                                               | no (no reader). **[EXT]** ask Grow to remove or disable the dashboard webhooks to the removed `/api/payments/grow` | Verify: the build passes; `/api/payments/grow/notify` still accepts the sandbox flow                                                                                                                                                                                       | re-create                                         |
| L   | `AUTOMATIONS_UNSUBSCRIBE_SECRET`                                                                                                                                                                                | Pr+P                                              | keep (never rotate without prior-secret verification: `automations/unsubscribeToken.ts:6–8`)                                 | own value                                                            | no                                                                                                                 | Verify: a lead unsubscribe link still works                                                                                                                                                                                                                                | re-add Preview                                    |
| M   | `RENDER_DIAG_SECRET`                                                                                                                                                                                            | Pr+P                                              | keep                                                                                                                         | own value                                                            | optional                                                                                                           | Readers: `billing/render-diag/route.ts:5`, `render-error/route.ts:19`, `lib/billing/pdf/schedule.ts:138`                                                                                                                                                                   | re-add Preview                                    |
| N   | `RESEND`                                                                                                                                                                                                        | P+Pr+D                                            | keep                                                                                                                         | a test key, or none                                                  | no                                                                                                                 | A Preview with copied data can email real users today. Without a key, Preview email fails closed (`config/resend.ts:3`)                                                                                                                                                    | re-add                                            |
| O   | branch-scoped Pr(b) entries (`design/billing-ui`, `feat/card-required-trial`: `APP_ENV`, `APP_HOST`, `NEXT_PUBLIC_APP_URL`, `GROW_*`, `CRON_SECRET`, `SECRETS_ENC_KEY`; `inbox-phase1-neon-test`: `JWT_SECRET`) | Pr(b)                                             | —                                                                                                                            | delete when the branch is finished (all three still exist on origin) | —                                                                                                                  | **Ask the owner** per branch                                                                                                                                                                                                                                               | re-create                                         |
| —   | `JWT_SECRET`, `AUTH_FACEBOOK_APP_*`                                                                                                                                                                             | P+Pr+D / Pr+P                                     | —                                                                                                                            | —                                                                    | —                                                                                                                  | **Authentication. Not in this plan** (§7)                                                                                                                                                                                                                                  | —                                                 |

---

## 5. What Preview must still have afterwards

These Preview-only values keep Preview deployments booting and the hard-coded
fallbacks out of use: its own `CRON_SECRET`, `SECRETS_ENC_KEY`,
`AUTOMATIONS_UNSUBSCRIBE_SECRET`, `RENDER_DIAG_SECRET`, and optionally
`UNSUBSCRIBE_SECRET`. Preview builds crash at module load without
`DATABASE_URL` or `RESEND`; `RESEND` falls under row N.

**Before row N**, confirm a Preview build with no `RESEND` still compiles
(`config/resend.ts:3` throws on a missing key at import time, which is what
broke the local build on 2026-11-01). If it doesn't, give Preview a Resend
**test** key instead of none.

---

## 6. Execution order (one approval per step; a checkpoint after each)

Every variable change takes effect only on the next deployment of that
environment. Changes that keep the Production value need **no** Production
redeploy. Each step names its checkpoint; do not continue until it passes.

1. **Deployment Protection on (A).** Identify the bypass entry first.
   Checkpoint:
   - a Preview URL opened logged-out shows the Vercel login;
   - `getsocialcrm.com` returns 200;
   - the next cron tick logs success;
   - a Meta webhook delivery and a Grow sandbox notify still arrive.

   This single setting covers every existing Preview at once, including the
   ones with baked-in secrets.

2. **Delete orphans (H, K).** Re-run the reader grep first. Checkpoint: a
   Preview build of `main` passes; Production is unchanged (no redeploy needed).
   **[EXT]** Ask Grow about the old dashboard webhook in parallel.
3. **`CRON_SECRET` scope split (C)**: narrow the entry to Production and add a
   Preview value in the same sitting. Checkpoint: no P+Pr row in
   `vercel env ls`; Production crons are untouched (same value, no redeploy);
   a fresh Preview build boots.
4. **`SECRETS_ENC_KEY` scope split (D).** Owner decision first: Preview loses
   every integration that relies on copied tokens. Checkpoint: in a new Preview,
   the Facebook status shows "could not be opened" (expected); Production
   checks pass (no redeploy, same value).
5. **Shared low-risk secrets (G, L, M, N)**: narrow each to Production and add
   Preview values. Checkpoint: Preview builds boot; Production unchanged.
6. **Meta and Google out of Preview (E, F, I)**, after the decision in §3
   (test apps or none). Remove Development from the Meta rows in the same step.
   Checkpoint: Production connect and token-refresh smoke tests pass; a new
   Preview has no Meta or Google credentials (`vercel env ls`).
7. **Delete old Preview deployments (B)**, after 1. Checkpoint: the Ready
   Preview count drops; no Production deployment is touched.
8. **Branch-scoped leftovers (O)**, per owner decision. Checkpoint:
   `vercel env ls` shows only the branches that are still active.
9. **Only then, and separately: `CRON_SECRET` rotation.** Preconditions:
   - C2 is done (`UNSUBSCRIBE_SECRET` holds the old value, or dual-verify code
     is merged);
   - every manual caller has been told;
   - the owner has confirmed no external scheduler exists, or it has been
     updated.

   Rotation is a Production change and a redeploy. Checkpoint: every cron logs
   success on its next tick; the old bearer gets 403; an old unsubscribe link
   still works. Rollback: restore the old value from the secret manager and
   redeploy.

Out of order on purpose: step 1 comes before every variable change, because
variable changes cannot reach deployments that already exist.

---

## 7. Found but outside this plan (needs explicit instruction: authentication)

- **`JWT_SECRET`** (P+Pr+D, plus a branch-scoped Preview entry): it signs
  production session cookies. A Preview-only value would stop Previews from
  minting production sessions. Rotating the Production value logs every user
  out. `MCP_JWT_SECRET` and `MOBILE_JWT_SECRET` are already separate
  (`lib/oauth/server/accessToken.ts:43–45` enforces that `MCP_JWT_SECRET`
  differs from both).
- **`AUTH_FACEBOOK_APP_SECRET`** (Pr+P): Facebook user login.
- Step 1 (Deployment Protection) reduces both exposures without touching auth.

## 8. Corrections to `docs/secrets-enc-key-execution-checklist.md`

- **1.2 (rotate `CRON_SECRET`):** blocked by the unsubscribe dependency (C2).
  It moves to step 9 here.
- **1.4 and 0.2:** `FACEBOOK_APP_*` are orphans, not a second app. The second
  Meta app id in use is `AUTH_FACEBOOK_APP_ID` (login, auth area).
- **6.3:** `GROW_TOKEN_SECRET` / `GROW_WEBHOOK_SECRET` have no reader. Delete
  them; don't rotate.
- **New, first:** Deployment Protection, plus deleting existing Previews.

## 9. Unresolved external dependencies

| #   | needs                      | question                                                                                                                                                                                                                                       |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | **Vercel** (project admin) | what is the one protection-bypass entry used for? Who may change Deployment Protection?                                                                                                                                                        |
| X2  | **Owner**                  | does n8n or any external scheduler call `coverage-sweep`, `announcements/whatsapp-templates` or any cron route?                                                                                                                                |
| X3  | **Owner / operators**      | who holds the current `CRON_SECRET` value (needed for C2 and manual runbooks)? Is it in a secret manager?                                                                                                                                      |
| X4  | **Meta**                   | Valid OAuth Redirect URIs and allowed domains of the integrations app: Production only? Create a test app for Preview, or accept none? Is `AUTH_FACEBOOK_APP_ID` the same app as `META_APP_ID`? (Compare ids in the dashboard, never secrets.) |
| X5  | **Google Cloud**           | the registered redirect URIs of both OAuth clients; whether the Picker API key is referrer-restricted; a test project for Preview, or none                                                                                                     |
| X6  | **Grow**                   | disable the dashboard webhooks that targeted `/api/payments/grow`; confirm nothing at Grow still uses `GROW_TOKEN_SECRET` / `GROW_WEBHOOK_SECRET`                                                                                              |
| X7  | **Owner**                  | are `design/billing-ui`, `feat/card-required-trial` and `inbox-phase1-neon-test` still active (their branch-scoped Preview variables)?                                                                                                         |
| X8  | **Owner**                  | accept that Preview loses Meta and Google integrations and copied-token access (steps 4 and 6)?                                                                                                                                                |
