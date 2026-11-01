# WhatsApp assistant — platform readiness

Read before the assistant is opened to more agencies. The automated part is
read-only; the manual part is a checklist for someone with Meta Business Manager
access. Nothing here sends a message or changes anything at Meta.

## 1. Automated check (read-only)

```
GET /api/internal/owner-wa/readiness?scope=agent
Authorization: Bearer $CRON_SECRET
```

`lib/whatsapp/platform/agentReadiness.ts`. Without `scope=agent` the route returns
the owner-reminder readiness exactly as before.

| check         | severity | passes when                                                                                                     | source        |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| config        | blocking | phone number id, WABA id, token, app id and secret are set                                                      | env           |
| token         | blocking | valid SYSTEM_USER token of this app, messaging granted on this WABA                                             | `debug_token` |
| phone         | blocking | CONNECTED, can send (AVAILABLE / LIMITED), quality not RED                                                      | phone node    |
| webhook       | blocking | this app is in `GET {waba}/subscribed_apps`                                                                     | WABA edge     |
| displayName   | blocking | `name_status` APPROVED or AVAILABLE_WITHOUT_REVIEW                                                              | phone node    |
| quality       | blocking | GREEN = ok, YELLOW = **warning** (passes, reported), RED = blocks; tier and LIMITED/BLOCKED reasons in `detail` | phone node    |
| business      | warning  | `business_verification_status` = verified                                                                       | WABA field    |
| accountReview | warning  | `account_review_status` = APPROVED                                                                              | WABA field    |

`ready` is true only when every blocking check is `ok` or `warning`. A read that
fails, or a field the Graph version does not return, is `unavailable` — never a
pass. Errors carry HTTP status and Graph code only, never Meta's message text.

`notVerifiable` lists what this check cannot establish: `wabaPaymentMethod`,
`metaBillingStatus`, `twoStepPin`, `trafficCapacity`.

## 2. Manual checks (Meta Business Manager)

Record the date and who checked each item.

- [ ] **Payment method** on the platform WABA is present and valid (WhatsApp Manager → Account tools → Payment methods). Not readable through this integration.
- [ ] **Billing status**: no overdue balance, no spending-limit hold (Billing & payments). Past incident on an agency WABA: Meta error 141006 (payment) blocked sends while the API reported the number as connected.
- [ ] **Business verification** of the owning Meta Business is Verified (Security Center). Cross-check with the `business` check.
- [ ] **Two-step verification PIN** is set on the platform number and stored in the team's secret manager (not in the repo, not in Vercel).
- [ ] **System-user token**: owned by the intended System User, `never expires`, and its rotation date recorded. Rotation procedure: create the new token, set `PLATFORM_WHATSAPP_ACCESS_TOKEN` in Vercel Production, redeploy, run the readiness check, then revoke the old token.
- [ ] **Messaging capacity**: current tier (also in the `quality` check), current quality rating, and any recent tier downgrade. The assistant only _replies_ inside the customer service window; Meta's current pricing and limits for those replies must be confirmed against Meta's documentation at the time of rollout.
- [ ] **Display name** approved and matching the brand the consent copy names.

## 3. Worker capacity (measured from code, 2026-11-01)

- Each queued owner message triggers one `after()` kick from the webhook (`lib/whatsapp/platform/delivery.ts`) that claims **one** job (`WA_ASSISTANT_LIMITS.batch = 1`); `/api/cron/wa-assistant` claims one more every minute.
- One sender is serialized: only their oldest queued message is claimable, and never while one of theirs is running (`db/waAssistantJobs.ts` `claimWaAssistantJobs`, `FOR UPDATE SKIP LOCKED`).
- Batch 1 is deliberate: a job can take ~46 s (typing 3 s + Agent 35 s + send 8 s) and both entry points stop at 60 s.
- Throughput therefore follows concurrent webhook invocations. If every kick failed, the cron alone drains ~1,440 jobs/day — far inside the 23-hour reply window at expected volume. A message from a sender whose previous job is still running waits for the next kick or cron tick (≤ 1 min).
- **Conclusion:** more concurrency is not needed now. Before a wide rollout, measure kick failures (`[WaAssistant][kick] failed`) and queue age; change the batch only if the queue age grows.

## 4. `SECRETS_ENC_KEY` (findings 2026-11-01; no value read or printed)

- Read by `lib/crypto/secrets.ts` (AES-256-GCM column encryption, wire format `IV | tag | ciphertext`, **no key id**) and `deriveSecretSubkey` (HKDF subkeys). It protects Google Drive/Calendar refresh tokens, Facebook Page tokens, WhatsApp connection tokens, payment-method and charge records, and — through subkeys — the owner-WhatsApp activation-code and sender hashes (`lib/whatsapp/platform/keys.ts`).
- In Vercel, **one variable entry spans Preview and Production**, so every preview deployment holds the production key. Preview uses `preview-shared`, a copy of production data, so previews can decrypt the copied production tokens.
- This machine's `.env.production.local` holds an **empty** value (Vercel does not let sensitive variables be pulled), so a direct fingerprint comparison is impossible. That the local `.env.local` key equals production's was confirmed in an earlier session by a decryption test; it was not repeated today.

**Rotation plan (not executed; needs explicit approval).** Superseded by the full
exposure assessment and runbook in `docs/secrets-enc-key-security-plan.md`; the
summary below is kept for context.

1. Code: a keyring — encrypt with `SECRETS_ENC_KEY`, decrypt trying `SECRETS_ENC_KEY` then `SECRETS_ENC_KEY_PREVIOUS`; prefix new ciphertexts with a key id so later rotations are mechanical. Tests: old and new ciphertexts both open; a tampered tag still fails.
2. Generate the new production key outside any developer machine; set it Production-only (separate from Preview), with the old key as `SECRETS_ENC_KEY_PREVIOUS`.
3. Re-encrypt every encrypted column with a resumable script (read-old / write-new, per table, in batches, logged by counts only).
4. HKDF subkeys change with the key: outstanding activation codes stop working and sender hashes change — schedule when no activation is pending, and re-derive stored hashes if any are persisted.
5. Give Preview its own key; the preview copy's sealed rows then need re-sealing or re-connection. Give local development a fresh dev key; no developer machine holds the production key.
6. After a full verification window, remove `SECRETS_ENC_KEY_PREVIOUS`, then revoke and re-issue the third-party tokens that were decryptable under the old key (Meta, Google), since the old key existed outside Production.
