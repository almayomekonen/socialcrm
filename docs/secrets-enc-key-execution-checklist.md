# `SECRETS_ENC_KEY` — execution checklist

Companion to `docs/secrets-enc-key-security-plan.md` (the why, the data map and
the exposure assessment). This file is the **how**: ordered, checkable steps
with a verification signal and a rollback for each one.

Status: **not started.** Every box is unticked and every step needs its own
approval. Nothing in this document has been run.

Legend:

- **[EXT]** needs coordination outside this repository: Meta, Google, Grow, or
  a person with Vercel or secret-manager access.
- **[PROD-ENV]** changes a Production variable. It takes effect only after a
  Production redeploy of `main`.
- **[DB-WRITE]** writes to a database. Production writes only through the
  reviewed scripts, never by hand.

Standing rules for every step:

- No value, hash or fingerprint of a key, secret or token is printed, pasted
  into chat, committed, or written to a log. Verification uses counts and
  pass/fail only.
- Read-only database checks use the **direct** host inside
  `BEGIN READ ONLY … ROLLBACK`, never `SET SESSION` on the pooler.
- No Neon branch is created for any of this (CLAUDE.md §16). A restore, if one
  is ever needed, uses a temporary branch with an owner and a deletion date.
- Production changes go out by merging to `main`, then confirming the
  Production deployment's commit SHA and the `getsocialcrm.com` alias.

---

## Phase 0 — decisions and inventory (no changes)

- [ ] **0.1 Owner decisions** (plan §5): approve the PR split; name the
      secret-manager owner; accept or reject the HMAC reset trade-off (Phase 5);
      approve scrubbing `preview-shared` (step 3.6); fix `CRON_SECRET` in
      Phase 1 (recommended).
- [ ] **0.2 [EXT] Meta.** Confirm in the Meta dashboard whether
      `FACEBOOK_APP_ID` and `META_APP_ID` are **the same app or two**. The
      proof in Phase 4 must use the secret of the app that issued each token.
      Compare the ids in the dashboard; never compare the secrets.
- [ ] **0.3 [EXT] Grow.** Ask whether card tokens are bound to the merchant
      (unusable without `GROW_USER_ID` + `GROW_PAGE_CODE_TOKEN`) and whether
      bulk re-tokenisation exists. Ask now: it has the longest lead time and
      blocks only Phase 6, not the rest.
- [ ] **0.4 [EXT] Preview test integrations.** Create a Meta **test app**
      and a Google **test OAuth client** (Drive + Calendar) for Preview, so
      Preview stops needing production secrets. Without them, Phase 1 breaks
      Preview's integrations. That is acceptable, but should be a decision.
- [ ] **0.5 Confirm the restore window.** Neon point-in-time restore covers at
      least the planned Phases 3–7 plus 7 days. Record the retention; read it
      from the Neon console, not by creating a branch.

## Phase 1 — stop new exposure (Vercel scoping only; no code, no data)

Smallest blast radius first: every step here only _removes_ production values
from Preview, or rotates a value no customer data depends on.

- [ ] **1.1 [EXT] `CRON_SECRET` separation.**
  - Edit the combined `Production, Preview` entry to **Production only**.
  - Add a new Preview-only entry, generated in the secret manager.
  - Remove the branch-scoped Preview entry for `feat/card-required-trial` if
    that branch is finished.
  - Verify: `vercel env ls` shows no `CRON_SECRET` row spanning both
    environments; a Preview deployment's cron routes return 401/403 with the
    _production_ bearer (checked by someone who holds it, without printing it).
- [ ] **1.2 [PROD-ENV][EXT] Rotate the Production `CRON_SECRET`.** It was
      present in every Preview build. Before changing it, list the callers:
  - the 15 Vercel crons in `vercel.json` (Vercel sends the current value
    automatically after redeploy);
  - any person or runbook that calls internal routes by hand (for example
    `/api/internal/owner-wa/readiness`);
  - any external scheduler. **Confirm with the owner whether any exists.**
    The 22 files that check the bearer are in the repo; their callers are not.

  Then set the new value, redeploy, and verify: the next cron tick of each
  route logs success in Vercel, and the old bearer gets 403.
  Rollback: put the old value back from the secret manager and redeploy.

- [ ] **1.3 [EXT] Google client secrets → Production only.**
      `GOOGLE_CALENDAR_CLIENT_*` and `GOOGLE_DRIVE_CLIENT_*` become Production
      entries; Preview gets the test client from 0.4. Values unchanged in
      Production for now; Phase 6 rotates them.
- [ ] **1.4 [EXT] Meta app secrets → Production only.** The same for
      `META_APP_SECRET` and `FACEBOOK_APP_SECRET` (the `Development` scope too).
      Preview gets the test app from 0.4.
- [ ] **1.5 Verify Phase 1.** `vercel env ls` (names and scopes only): none of
      `CRON_SECRET`, `META_APP_SECRET`, `FACEBOOK_APP_SECRET`,
      `GOOGLE_*_CLIENT_SECRET` spans Preview and Production.

After Phase 1, a Preview build can still _decrypt_ copied tokens, but can no
longer refresh Google tokens or call production cron routes. Page and WABA
tokens are still usable on their own until Phase 4 (`appsecret_proof`).

## Phase 2 — code that can read old and new (three PRs; deploys change nothing)

### 2.1 PR S1 — keyring and HMAC root (`lib/crypto/secrets.ts`)

- [ ] **Envelope for new writes:** `sk2.<kid>.<base64(IV‖tag‖ciphertext)>`.
      `kid` matches `^[a-z0-9]{1,16}$`; the envelope is ASCII-safe for `text`
      columns and cookies.
- [ ] **Read compatibility, kept indefinitely:**
  - `sk2.` → the key named by `kid`; an unknown kid is an error, never a fallback;
  - `scm1.` + blob, `scmp1.` + blob, and bare blob → try the current key, then
    each previous key (the GCM tag rejects a wrong key deterministically);
  - legacy plaintext pass-through stays **exactly** where it is today
    (`resolvePageAccessToken`, `resolveWhatsappAccessToken`) and nowhere else.
- [ ] **Configuration** (all optional, so the deploy is inert):
  - `SECRETS_ENC_KEY` + `SECRETS_ENC_KEY_ID`: sealing; with no id, writes stay
    in today's format, so S1 is a no-op until 3.3;
  - `SECRETS_ENC_KEYS_PREVIOUS`: `kid:base64,…`, decrypt only;
  - `SECRETS_HMAC_ROOT`: used by `deriveSecretSubkey`, defaulting to
    `SECRETS_ENC_KEY`.
- [ ] **Callers:** the seal helpers (`sealPageAccessToken`,
      `sealWhatsappAccessToken`, `pendingPages`, Google token writers,
      `db/payments/*`) write through the new envelope. `scripts/resolvePageToken.cjs`
      and `scripts/seal_facebook_page_tokens.cjs` call the shared module
      instead of their own copy.
- [ ] **Tests:**
  - fixtures in each legacy format open;
  - new values carry the kid;
  - a tampered tag fails, and so do a wrong kid and an unknown kid;
  - plaintext pass-through is unchanged and absent elsewhere;
  - HMAC output is byte-identical while `SECRETS_HMAC_ROOT` is unset;
  - no error message or log contains key material or plaintext;
  - a malformed `SECRETS_ENC_KEYS_PREVIOUS` fails at startup with a message
    naming the variable, never its value.
- [ ] **Verify after deploy:** with no variable changed, `--report` (2.2) shows
      the same format counts as before, and the Facebook, Drive, Calendar,
      WhatsApp-send and billing read paths work for a test agency.

### 2.2 PR S2 — re-encryption and report script (`scripts/`)

- [ ] **`--report` (read-only):** per table and column, counts by format
      (`sk2.<kid>`, `scm1.`, bare blob, legacy plaintext, NULL) and the count
      of values that fail to open. Counts only.
- [ ] **`--reseal --target-kid <kid>`:**
  - Dry run by default. Writing needs `--write --database <name>`, and the
    name must match the connected database.
  - Batches of ≤ 200 ordered by primary key, with a resumable cursor file
    holding ids only.
  - Each update is conditional: `WHERE id = ? AND col = <value read>`. A row
    refreshed concurrently is skipped and re-read on the next pass, never
    overwritten.
  - Also seals the legacy plaintext rows in `facebook_pages` and
    `whatsapp_connections`.
  - Cookies are not rewritten; they expire.
- [ ] **Covers all 8 columns:**
  - `facebook_pages.access_token`
  - `facebook_ad_connections.accessToken`
  - `whatsapp_connections.access_token`
  - `google_calendar_connections.{access_token,refresh_token}`
  - `google_drive_connections.{access_token,refresh_token}`
  - `billing_payment_methods.{cardToken,setupProcessToken}`
  - `billing_charges.providerTransactionToken`
- [ ] **Tests (local database only):** idempotent; resumable after a kill
      mid-batch; a concurrent update is never lost; a value that cannot be
      opened is counted and left untouched; `--report` equals the truth.

### 2.3 PR S3 — `appsecret_proof` on every Graph call

- [ ] **One helper.** It takes a token and its app (from 0.2) and adds
      `appsecret_proof`. `lib/facebook/graphClient.ts` already does this
      (`appSecretProof`); reuse it, don't fork it.
- [ ] **The 23 files that call Graph directly without the proof today:**
      `app/api/auth/facebook/{callback,disconnect}/route.ts`,
      `app/api/auth/whatsapp/connect/route.ts`,
      `app/api/whatsapp/{callback,embedded-signup}/route.ts`,
      `app/api/whatsapp/media/[messageId]/route.ts`,
      `lib/auth/verifyFacebookAccessToken.ts`,
      `lib/facebook/{ads/handleAdsOAuthCallback,conversionsApi,discoverPages,health,leadNodeFetch}.ts`,
      `lib/whatsapp/{attachExistingWaba,coexistence,registration,resolveWaba,sendMessage,sendTemplateMessage}.ts`,
      `lib/whatsapp/templates/graph.ts`,
      `lib/whatsapp/platform/{agentReadiness,readiness,sendReminder,sendText}.ts`.
      Re-run the inventory when the PR is written; files change.
- [ ] **Client-side check.** Find every browser-side Graph or SDK call
      (Facebook JS SDK, Embedded Signup). "Require App Secret" refuses calls
      that cannot carry a proof, so each must be either a code exchange done
      server-side or explicitly exempt.
- [ ] **Tests:** every Graph request in the suites carries a proof computed
      with the right app's secret; the proof never appears in a log; a missing
      secret fails closed with a named error.
- [ ] **Verify after deploy:** connect, page refresh, lead fetch, a WhatsApp
      send and a template list work for a test agency; Meta's app dashboard
      shows calls with proof.

Merge order: S1, then S2, then S3. Each deploy is confirmed (SHA + alias)
before the next.

## Phase 3 — split the encryption key (key change + Production re-encryption)

- [ ] **3.1 Before.**
  - `--report` on Production: counts only, saved to the change record.
  - No owner activation pending.
  - Restore window confirmed (0.5).
  - `K1` (current) present in the secret manager.
- [ ] **3.2 [EXT] Generate keys in the secret manager.** `K2` for Production
      and `KP` for Preview, 32 random bytes each, base64. Never generated or
      stored on a developer machine.
- [ ] **3.3 [PROD-ENV] Production variables:**
  - `SECRETS_ENC_KEY=K2`, `SECRETS_ENC_KEY_ID=k2`;
  - `SECRETS_ENC_KEYS_PREVIOUS=k1:K1`;
  - `SECRETS_HMAC_ROOT=K1`, so hashes do not move yet.

  The shared `Preview, Production` entry becomes **Production only**. Redeploy.

- [ ] **3.4 Verify** (the read paths from 2.1). New writes appear as `sk2.k2.`
      in `--report`. Watch the log signals (Phase 7) for one hour.
- [ ] **3.5 [DB-WRITE] Re-encrypt Production.** S2 dry run, then
      `--write --database <prod>`. Done when `--report` shows 0 values outside
      `sk2.k2` and 0 that fail to open, legacy plaintext included.
- [ ] **3.6 Preview** (approved in 0.1):
  - a new Preview-only `SECRETS_ENC_KEY=KP` with `SECRETS_ENC_KEY_ID=kp`;
  - **[DB-WRITE] on `preview-shared` only:** clear the copied third-party and
    payment tokens, then reconnect the test accounts from 0.4;
  - every future copy of production into Preview excludes these columns.
- [ ] **3.7 Local development.**
  - A fresh dev-only key.
  - Each machine owner deletes `K1` and the production `DATABASE_URL`
    (`.env.local`, `.env.production.local`, shell history, password-manager
    exports).
  - Nobody prints the files to check; the owner confirms deletion in writing.

## Phase 4 — Meta proof enforcement [EXT]

- [ ] **4.1** S3 deployed and verified (2.3). Every server call already sends
      the proof.
- [ ] **4.2 [EXT][PROD-ENV] Reset the Meta app secret(s)** for the app(s) from
      0.2. Set the new value Production-only and redeploy. Window: between the
      reset and the redeploy, server calls fail, so do both in one sitting at a
      quiet hour.
- [ ] **4.3 [EXT] Enable "Require App Secret"** in the Meta app settings.
      Verify: a test-agency send and lead fetch still work. A call without a
      proof is refused (checked with a test app token, never a production one).
- [ ] **4.4 [EXT] Platform number:** rotate the system-user token
      (`docs/wa-assistant-readiness.md`, manual checks). Then
      `?scope=agent` readiness must be ready, with the token check ok.
- [ ] **4.5 Agency tokens believed misused** (if any): the agency reconnects
      its Page or WABA. Not done blanket.

## Phase 5 — the two key-derived WhatsApp hashes

The hashes are `owner_whatsapp_recipients.activationCodeHash`
(`owner-wa-activation-code-v1`) and `platform_whatsapp_inbound.fromHash`
(`platform-wa-from-v1`).

- [ ] **5.1 Decision from 0.1.** Option A (recommended): move to a new
      dedicated root. Option B: keep `K1` as a permanent HMAC-only root in
      Production. B never resets anything, but `K1`, which was exposed, stays
      live forever. Choose A unless pending activations are routine.
- [ ] **5.2 (Option A) Preconditions:** a count of pending activations
      (`activationCodeHash IS NOT NULL`, count only) equals 0; quiet hour.
- [ ] **5.3 [EXT][PROD-ENV]** Set `SECRETS_HMAC_ROOT` to a new secret
      generated in the secret manager. Redeploy.
- [ ] **5.4 Accepted effects:**
  - codes issued before 5.3 no longer match;
  - the hourly rejected-activation counter and the out-of-order opt-out guard
    start fresh;
  - opt-outs themselves are kept by phone (`optOutByPhone`) and are not affected.
- [ ] **5.5 Verify:** an activation by a test owner end to end (consent, code,
      inbound) succeeds, and an opt-out by phone still blocks reminders.
      Message only test numbers, with separate approval for that send.

## Phase 6 — third-party credential rotation

- [ ] **6.1 [EXT] Google.** For each OAuth client (Calendar, Drive): add a
      new client secret, switch Production to it, redeploy, verify a token
      refresh for a test user, then disable the old secret. Stolen refresh
      tokens cannot be exchanged without the current secret, so no user
      reconnects. Confirm against Google's current OAuth client-secret
      rotation documentation at execution time.
- [ ] **6.2 Meta.** Done in Phase 4.
- [ ] **6.3 [EXT] Grow** (from 0.3):
  - If tokens are merchant-bound: no card action. Record the answer.
  - If not: plan with Grow, and only then decide on re-tokenisation. Never
    ask customers to re-enter cards on assumption.
  - Rotate `GROW_TOKEN_SECRET` and `GROW_WEBHOOK_SECRET` the same way as
    `CRON_SECRET`: both currently span Preview and Production.

## Phase 7 — verification window and retirement

- [ ] **7.1 Seven days of watching:**
  - `[FacebookStatus] Page token could not be opened`;
  - Drive/Calendar `refresh_failed` / `revoked`;
  - WhatsApp send auth errors (Graph 190);
  - billing charge-path errors;
  - plus `--report` showing 0 values that fail to open, daily.
- [ ] **7.2 [PROD-ENV] Remove `SECRETS_ENC_KEYS_PREVIOUS`** and redeploy, only
      after 7.1 is clean and `--report` shows 0 values on `k1`.
- [ ] **7.3 [EXT] Retire `K1`** from the secret manager last, once the restore
      window holding `K1`-sealed rows is accepted as unreadable. Those tokens
      are revoked or neutralised by then.

---

## Rollback and recovery

| after                             | rollback                                                                                                                         | loss                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1.1–1.4 (scoping)                 | restore the previous scope or value from the secret manager; redeploy                                                            | none                                                       |
| 1.2 (cron rotation)               | old value back; redeploy                                                                                                         | none; missed ticks re-run on the next minute               |
| 2.x deploys                       | revert the PR                                                                                                                    | none, because no data or variable changed                  |
| 3.3 (key switched)                | `SECRETS_ENC_KEY=K1`, `SECRETS_ENC_KEY_ID=k1`, **`SECRETS_ENC_KEYS_PREVIOUS=k2:K2`**; redeploy. Never roll back by dropping `K2` | none: values written under `K2` still open                 |
| 3.5 (re-encrypted)                | S2 with `--target-kid k1` while both keys are in the ring                                                                        | none                                                       |
| 3.6 (Preview scrubbed)            | reconnect the test accounts; production data is untouched                                                                        | Preview only                                               |
| 4.2 / 4.3 (Meta)                  | disable "Require App Secret"; a reset secret cannot be restored, so roll _forward_ with the new secret                           | brief call failures during the window                      |
| 5.3 (HMAC root)                   | `SECRETS_HMAC_ROOT=K1`; redeploy                                                                                                 | codes issued after 5.3 must be re-requested                |
| 6.1 (Google)                      | re-enable the old secret, which Google keeps until it is deleted                                                                 | none                                                       |
| a key lost before 7.3             | restore from the secret manager                                                                                                  | none                                                       |
| a key lost and not in the manager | Neon PITR of the affected columns into a temporary branch (owner + deletion date), then copy the columns back                    | tokens refreshed after the restore point need reconnecting |

A key leaves the keyring only after `--report` shows nothing in Production
still depends on it.

## Steps needing external coordination (summary)

| step                                   | with whom                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0.2, 0.4, 1.4, 4.2–4.5                 | **Meta**: app-dashboard access, test app, secret reset, "Require App Secret", system-user token |
| 0.4, 1.3, 6.1                          | **Google Cloud**: test OAuth client, client-secret rotation                                     |
| 0.3, 6.3                               | **Grow**: card-token binding and re-tokenisation, webhook and token secrets                     |
| 1.1, 1.2, 3.2, 3.3, 3.6, 5.3, 7.2, 7.3 | **Vercel and secret-manager holders**                                                           |
| 1.2                                    | **anyone who calls internal routes by hand or from an external scheduler**                      |
| 3.7                                    | **every developer machine owner**                                                               |
| 0.5                                    | **Neon console** (read only)                                                                    |
