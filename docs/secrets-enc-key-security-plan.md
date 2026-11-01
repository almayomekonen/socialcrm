# `SECRETS_ENC_KEY` — exposure assessment and rotation plan

Status: **plan only.** Nothing here has been executed. No key has been rotated,
no encrypted row changed, no Vercel variable edited. Every execution step below
needs its own explicit approval. This is a separate security task, deliberately
not part of the GA Phase 1 work (#184).

Assessed 2026-11-01 from the code on `main` (14addfae) and the Vercel variable
_listing_ (names, environments and branch scopes only — no value was read,
printed, hashed or fingerprinted).

---

## 1. What the key protects

`lib/crypto/secrets.ts`: AES-256-GCM, a fresh 12-byte IV per value, wire format
`base64(IV ‖ tag ‖ ciphertext)`. **There is no key id in the ciphertext**, so
today a value can only be opened by trying the one configured key.
`deriveSecretSubkey(purpose)` derives HMAC keys from the same key with HKDF.

### Encrypted columns (all Postgres `text`)

| table.column                                                 | what it is                                          | format                                                 | written by                                                               |
| ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `facebook_pages.access_token`                                | Page access token (long-lived)                      | `scm1.` + blob; **legacy plaintext rows pass through** | `app/api/auth/facebook/connect`, `lib/facebook/refreshConnectedPages.ts` |
| `facebook_ad_connections.accessToken`                        | Ads-reporting user token                            | `scm1.` + blob (no plaintext legacy)                   | `db/facebookAds.ts`                                                      |
| `whatsapp_connections.access_token`                          | Agency WABA token (Embedded Signup / manual attach) | `scm1.` + blob; **legacy plaintext rows pass through** | `lib/whatsapp/attachExistingWaba.ts`                                     |
| `google_calendar_connections.access_token`, `.refresh_token` | Google OAuth tokens (Calendar)                      | bare blob                                              | calendar callback, `lib/integrations/google/calendarTokens.ts`           |
| `google_drive_connections.access_token`, `.refresh_token`    | Google OAuth tokens (Drive)                         | bare blob                                              | drive callback, `lib/integrations/google/driveTokens.ts`                 |
| `billing_payment_methods.cardToken`                          | Grow card token (recurring charge)                  | bare blob                                              | `db/payments/paymentMethods.ts`                                          |
| `billing_payment_methods.setupProcessToken`                  | Grow card-setup process token                       | bare blob                                              | `db/payments/paymentMethods.ts`                                          |
| `billing_charges.providerTransactionToken`                   | Grow transaction token                              | bare blob, nullable                                    | `db/payments/charges.ts`                                                 |

### Not a column, same key

- `fb_pages` cookie (`lib/facebook/pendingPages.ts`): `scmp1.` + blob, carries
  the Page tokens between the Facebook OAuth callback and page selection.
  A key change invalidates connects in flight; the user starts again.
- `scripts/resolvePageToken.cjs` re-implements decryption and
  `scripts/seal_facebook_page_tokens.cjs` seals legacy rows; both read
  `SECRETS_ENC_KEY` directly and must follow any format change.

### HMACs derived from the key (one-way; cannot be re-computed for lost inputs)

| purpose                       | stored in                                      | effect if the root changes                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner-wa-activation-code-v1` | `owner_whatsapp_recipients.activationCodeHash` | an activation code issued before the change no longer matches; the owner requests a new one                                                                                                                         |
| `platform-wa-from-v1`         | `platform_whatsapp_inbound.fromHash`           | the hourly rejected-activation limit and the out-of-order opt-out guard (`hasOptOutAtOrAfter`) lose history from before the change. The opt-out itself is stored by phone (`optOutByPhone`) and is **not** affected |

---

## 2. Who can decrypt what today

| environment                        | key                                                                                                                                                                         | data it can reach                                                                                                               | can it _use_ the decrypted tokens?                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production                         | the shared entry (`Preview, Production`, created ~161 days ago)                                                                                                             | production DB                                                                                                                   | yes — by design                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Preview, every branch except one   | **the same shared entry**                                                                                                                                                   | `preview-shared`, a copy of production data (taken 2026-09-29) — so every production token sealed before that date              | **yes for Meta and Google**: Preview also has `META_APP_SECRET`, `FACEBOOK_APP_SECRET`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_DRIVE_CLIENT_SECRET`. Page/WABA tokens need no secret at all; Google refresh tokens need the client secret, which Preview has. **Not for Grow**: default Preview has no `GROW_USER_ID` / `GROW_PAGE_CODE_TOKEN` / `GROW_MODE`, so card tokens open but have no merchant credentials beside them |
| Preview `feat/card-required-trial` | its own branch-scoped key                                                                                                                                                   | `preview-shared`                                                                                                                | cannot open production-sealed rows                                                                                                                                                                                                                                                                                                                                                                                               |
| Vercel Development                 | none set                                                                                                                                                                    | —                                                                                                                               | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Local development (this machine)   | `.env.local` holds the **production key** — confirmed by a decryption test in an earlier session (memory note: created 2026-05-24, never rotated); not re-run on 2026-11-01 | the same machine also has a production `DATABASE_URL` (`.env.production.local`), so it can read and open every production token | yes — the same as Preview, plus production itself                                                                                                                                                                                                                                                                                                                                                                                |

**What this means.** Anyone who can push a branch gets a Preview build that runs
their code with the production key and the Meta/Google app secrets, against a
database holding copied production tokens. Whether a Preview URL is reachable
by outsiders does not matter here: the branch's own code runs server-side at
build and at request time. And a developer machine holds everything needed to
open production tokens directly.

Adjacent (not this key, same pattern, listed so it is not lost): `CRON_SECRET`
is one entry for `Production, Preview`, so a Preview build holds the bearer
that authorises production's internal and cron endpoints.

---

## 3. Remediation — three PRs and one runbook

Order matters: code that can read both keys ships **before** any key changes, so
every step has a rollback that loses nothing.

### PR S1 — keyring (code only; no behaviour change when deployed)

- New envelope for every **new** write: `sk2.<kid>.<base64(IV‖tag‖ct)>`, used
  for all eight columns and the cookie. The `scm1.` / `scmp1.` prefixes and
  bare blobs stay **readable** indefinitely; legacy plaintext pass-through for
  `facebook_pages` / `whatsapp_connections` keeps its current rule.
- Configuration:
  - `SECRETS_ENC_KEY` + `SECRETS_ENC_KEY_ID`: the key every new value is sealed with.
  - `SECRETS_ENC_KEYS_PREVIOUS`: `kid:key,kid:key`, used for decryption only.
- Decryption: an `sk2.` value is opened with the key its kid names (an unknown
  kid is an error, never a fallback). A legacy value (no kid) is tried against
  the current key, then each previous one. GCM's tag makes a wrong key fail
  deterministically, so trying keys is safe.
- **Decouple the HMAC root:** `deriveSecretSubkey` reads `SECRETS_HMAC_ROOT`,
  defaulting to `SECRETS_ENC_KEY` when unset. Rotating the encryption key then
  never moves the hashes by accident (see the runbook, step 4).
- `scripts/resolvePageToken.cjs` and `scripts/seal_facebook_page_tokens.cjs`
  call the shared module instead of their own copy.
- Tests: old `scm1.`, `scmp1.` and bare blobs still open; new values carry the
  kid; tampered tag fails; wrong or unknown kid fails; plaintext pass-through is
  unchanged where it exists today and absent everywhere else; no key material
  or plaintext appears in any error or log line; HMAC output is unchanged while
  `SECRETS_HMAC_ROOT` is unset.

### PR S2 — re-encryption script (dry run by default)

- Per table and column, in batches, every value not already `sk2.<current kid>.`
  is opened with the keyring and rewritten under the current key. Each update
  is conditional (`WHERE id = ? AND col = <old value>`), so a token refreshed
  concurrently is never overwritten with a stale one.
- It also seals the remaining legacy plaintext rows in the two token tables.
- Resumable and idempotent. It logs counts only (per table, per format, per
  outcome). It refuses to write without an explicit confirmation flag naming
  the database.
- A read-only `--report` mode gives counts by format per column. This is the
  verification signal for the runbook.

### PR S3 — Graph `appsecret_proof` everywhere (enables step 8)

Some Facebook Graph calls already send `appsecret_proof`
(`lib/facebook/graphClient.ts`, `pageDiscoveryDiagnostics.ts`,
`messenger/sendAttachment.ts`), but 10 files call Graph and not all of them do.
Meta's "Require App Secret" setting may be enabled only after every call sends
the proof; then a token alone is useless without the (rotated,
Production-only) app secret.

### Runbook (each step separately approved; read-only checks on the direct host, never the pooler)

0. **Before anything.** Merge and deploy S1–S3 with no variable change. Run
   `--report` on Production (counts only). Confirm no owner activation is
   pending. Confirm the Neon point-in-time-restore window covers the whole
   operation. No Neon branch is created for this (CLAUDE.md §16); a restore,
   if ever needed, uses a temporary branch with an owner and a deletion date.
1. **New keys, generated off developer machines** (in the team secret manager),
   never pasted into chat, the repo or a terminal log: `K2` for Production and
   `KP` for Preview. Store `K1` (current) in the same place until step 9.
2. **Split the shared Vercel entry.**
   - Production: `SECRETS_ENC_KEY=K2`, `SECRETS_ENC_KEY_ID=k2`,
     `SECRETS_ENC_KEYS_PREVIOUS=k1:K1`, `SECRETS_HMAC_ROOT=K1` (keeps hashes
     stable for now).
   - Preview: its own Production-free entry with `KP`.
   - Redeploy Production and verify: Facebook status, a Drive or Calendar read,
     a WhatsApp send path in a test agency and a billing read all still open
     their tokens; new writes are `sk2.k2.`.
3. **Re-encrypt Production:** S2 dry run, then the real run, then `--report`.
   Done when every column shows 0 values not on `k2`.
4. **HMAC root:** set `SECRETS_HMAC_ROOT` to a new dedicated secret at a moment
   with no pending activation. Accepted one-time effects: pending codes must be
   re-requested; the 1-hour activation limit and the out-of-order opt-out guard
   restart (opt-outs themselves are kept by phone). Without this step `K1` would
   have to stay in Production for good.
5. **Preview data.** `preview-shared` rows sealed with `K1` stop opening in
   Preview, which is the point. Approve separately, as a write to the Preview
   database: clear the copied third-party tokens and payment tokens in
   `preview-shared`, and reconnect test accounts there. Future copies of
   production into Preview should exclude those columns.
6. **Local development:** a fresh dev-only key. `K1` and the production
   `DATABASE_URL` are removed from every developer machine. The owner of each
   machine deletes them; nobody prints them to check.
7. **Verification window, 7 days:** watch for open failures
   (`[FacebookStatus] Page token could not be opened`, Drive/Calendar refresh
   errors, WhatsApp send auth errors, charge-path errors), then remove
   `SECRETS_ENC_KEYS_PREVIOUS` and redeploy.
8. **Third-party tokens.** Because `K1` and copies of the ciphertext existed
   outside Production, treat every token sealed under `K1` as exposed:
   - **Google:** rotate both OAuth client secrets (add new, switch, disable
     old) and make them Production-only. Stolen refresh tokens then cannot be
     exchanged without the new secret, and no user has to reconnect. Confirm
     this against Google's current documentation before executing.
   - **Meta / Facebook / WhatsApp:** after S3, reset the app secret and make it
     Production-only, then enable "Require App Secret". Tokens without the proof
     are refused. Where a token is believed misused, the affected agency
     reconnects (Page or WABA re-onboarding). Platform number: rotate the system
     user token per the readiness runbook (`docs/wa-assistant-readiness.md`).
   - **Grow:** card tokens are usable only with merchant credentials, which are
     Production-only, so the exposure is lower. Ask Grow whether tokens are
     merchant-bound and whether bulk re-tokenisation exists before deciding
     anything. Never force customers to re-enter cards on assumption.
9. **Retire `K1`:** delete it from the secret manager last — after step 7, after
   step 8, and only once the restore window that still holds `K1`-sealed rows
   is accepted as unreadable (those tokens are revoked by then anyway).

---

## 4. Rollback and recovery

| point                                             | rollback                                                                                                                                                        | data loss                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| after S1–S3 deploy                                | revert the deploy                                                                                                                                               | none — no row changed, the format is still readable                                                                                  |
| after step 2 (key switched, before re-encryption) | set the current key back to `K1` and **add `k2:K2` to `SECRETS_ENC_KEYS_PREVIOUS`**, then redeploy                                                              | none: values written under `K2` in the meantime still open. The keyring makes the switch symmetric; never roll back by dropping `K2` |
| during or after step 3                            | S2 targeting `k1` re-seals back; both keys are in the ring                                                                                                      | none                                                                                                                                 |
| after step 4                                      | set `SECRETS_HMAC_ROOT` back to `K1`                                                                                                                            | codes issued under the new root must be re-requested again                                                                           |
| a key lost before retirement                      | it is in the secret manager (step 1); if not, Neon PITR restores the affected columns into a temporary branch (owner + deletion date), and they are copied back | bounded by the restore point; tokens refreshed after it need reconnecting                                                            |
| decrypt failures after step 7                     | put `SECRETS_ENC_KEYS_PREVIOUS` back (from the secret manager) and investigate with `--report`                                                                  | none                                                                                                                                 |

Rule of thumb: a key leaves the ring only after `--report` proves nothing in
Production depends on it.

---

## 5. Open questions for the owner

1. Approve S1–S3 as three separate PRs? Do they go before or after the
   GA rollout steps?
2. Who holds the team secret manager, and where are `K2`, `KP` and the HMAC
   root generated?
3. Approve the step-4 trade-off (one-time reset of pending codes and the hourly
   activation window), or keep `K1` as a permanent HMAC root instead?
4. Approve clearing copied production tokens in `preview-shared` (step 5), and
   excluding them from future copies?
5. `CRON_SECRET` shares the same Preview/Production pattern. Fix it in the same
   window or separately?
