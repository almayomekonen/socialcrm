# SmartBee Sandbox checklist

For the one agency on `SMARTBEE_AGENCY_IDS` (the `talismanvideo@gmail.com` account). Sandbox only: `https://test.smartbee.co.il/api/v1`. Production stays off (`SMARTBEE_PRODUCTION_ENABLED` absent).

## 0. What SmartBee must give us first

| Needed | Used as |
|---|---|
| Our provider `clientId` + `password` for the test server | `SMARTBEE_TEST_CLIENT_ID`, `SMARTBEE_TEST_CLIENT_PASSWORD` |
| The connection code for the test business account | `SMARTBEE_PROVIDER_USER_TOKEN` (assumed to be the `providerUserToken`; confirm with SmartBee) |
| The test business's type | `--business-type exempt / authorized / company` |

Keep all three in your shell environment only. Never pass them as arguments, never in a file in the repo.

## 1. Direct API tests (no WhatsApp, no database)

Script: `scripts/smartbee/sandbox-document.ts`. Run each line first WITHOUT `--apply` and read the printed body; then add `--apply`. Record the `providerMsgId`, the create answer and the final poll answer.

| # | Case | Command flags | Expected |
|---|---|---|---|
| 1 | InvoiceReceipt, cash, incl. VAT | `--type InvoiceReceipt --amount 100 --vat incl --payment cash --business-type authorized` | create `101` → poll `1` … `102` with `documentId`, `index`, PDF links |
| 2 | Invoice, before VAT | `--type Invoice --amount 100 --vat excl --business-type authorized` | `102`; PDF total = 100 + SmartBee's VAT |
| 3 | Receipt, cash | `--type Receipt --amount 50 --payment cash --business-type authorized` | `102` |
| 4 | Receipt, credit card, 3 installments | `--type Receipt --amount 300 --payment credit_card --installments 3 ...` | `102`; card type "Other", deal "Installments" |
| 5 | Receipt, check | `--type Receipt --amount 80 --payment check --check-number 1234 ...` | `102`, or `96` if the business requires full check details (record which) |
| 6 | Receipt, bank transfer | `--type Receipt --amount 90 --payment bank_transfer --reference R1 ...` | `102`, or `96` if full transfer details are required (record which) |
| 7 | Receipt, Bit | `--type Receipt --amount 40 --payment other --label ביט ...` | `102`; check how "ביט" prints on the PDF |
| 8 | Customer ID number | add `--id-number 012345678` to case 1 | `102`; ID printed; note whether `taxConfirmationNumber` is returned |
| 9 | Duplicate | re-run case 1 with `--msg-id <its id>` | create `95` with the ORIGINAL message id; still one document in SmartBee |
| 10 | Poll later | `--poll <apiMessageId> --apply` | the same `102` result again |
| 11 | Invalid business token | `SMARTBEE_PROVIDER_USER_TOKEN=wrong` with case 3 | create `98`, nothing created |
| 12 | Type the business may not issue | only if the test account is עוסק פטור: case 2 with `--business-type authorized` | poll `99` per the guide (record the real answer) |

After every case, open SmartBee's test UI and confirm: one document per `providerMsgId`, the amount, the payment method, and that NO email was sent to a customer (`sendOriginalToCustomer:false`).

Refused before any call, by design (no SmartBee request is made): an Invoice for an exempt business, an InvoiceReceipt before VAT, a check without a number, Bit without a label.

## 2. Connect the agency (database)

`scripts/smartbee/connect.ts` writes the encrypted business token to `smartbee_connections`. Its dry run checks the owner email (exactly one ADMIN/MNGR user) and the token (a one-row SmartBee search). It writes only with `--apply`, and prints the target database first.

Two separate things, never to be confused:

| Check | How | Real sandbox answer |
|---|---|---|
| **Authentication** (our client) | `POST /login/authenticate` | HTTP 200 `{token, expirationUtcDate}`, 7-day JWT |
| **Business token recognized** | the one-row search | `120` (search allowed) or `94` (see below); `98` = token not valid → refused |
| **Search authorization** | the same search | `120` only. `94` + `NotAuthorized: Required roles not found for action: documents/search` = the token IS recognized but search is NOT available |

The script accepts that exact `94` and prints "business token recognized … Search is NOT available". It never reports search as working on a 94. Any other 94 (no search wording) or any other code is refused. Document creation and polling never use search, so issuance does not depend on it; a 94 from create or poll is still a failure.

This needs a decision: the agency and its owner live in the PRODUCTION database. The migration `20261113140000_smartbee_integration.cjs` must be applied there first (release workflow §8b), and the connection row written there, each approved separately.

## 3. WhatsApp end-to-end (after 2, and after a deployment decision)

The owner's WhatsApp messages reach only the production webhook, so this step needs this branch deployed to production with `SMARTBEE_AGENCY_IDS=<agency>` and the sandbox credentials set. Each of those is a separate approval.

| # | Owner writes | Expected |
|---|---|---|
| W1 | "תפיק חשבונית מס קבלה ל<lead> על <x>, 100 שקל כולל מע"מ, שולם במזומן" | card with type, customer, ID number, amount, payment, attestation; nothing in SmartBee yet |
| W2 | tap "לאשר ולהפיק" | "נמסרה ל-SmartBee וממתינה"; then one message with number, allocation number (if any), PDF link |
| W3 | the same button again | "הבקשה הזו כבר טופלה"; still one document |
| W4 | "תוציא קבלה ל<lead> 50 שקל" (no method) | one question: how was it paid |
| W5 | a second request for the same lead while W2 is still pending | refused: an earlier request is waiting |
| W6 | another admin of the agency asks | refused: only the account owner |
| W7 | after a stalled notice: "המסמך לא קיים" → tap | recorded; the lead can get a new document |

## Results: 2026-11-11 (real sandbox)

- Login: HTTP 200 `{token, expirationUtcDate}`; JWT `exp` = `expirationUtcDate` = issue + 7 days. As implemented.
- Search with the business token: HTTP 200, `94`, `validationErrors: {"NotAuthorized":"Required roles not found for action: documents/search"}`. A wrong token gets `98`, so the token is checked first. `connect.ts` now accepts this exact 94 as "recognized, search unavailable" (it refused it when first run).

Observed result codes:

| Situation | Code |
|---|---|
| Search, valid token, no search permission | `94` |
| Any call with an invalid business token | `98` |
| Create accepted | `101` |
| Poll, still processing | `1` |
| Poll, document created | `102` |
| Create with an already-used `providerMsgId` | `95` (original message id) |

- Create: `101` with `result` = apiMessageId. Poll: `1`, `1`, then `102` after ~7 s. The `result` keys are `documentId`, `index` (a number), `taxConfirmationNumber` (null), `linkToOriginal`, `linkToCopy`, `docType`. Both links serve a valid 1-page PDF 1.7 (HTTP 200, no `Content-Type` header).
- Passed: case 3 (Receipt cash, #700001), 4 (card ×3, #700002), 5 (check, #700003), 6 (transfer, #700004), 7 (Bit, #700005), 9 (duplicate → `95` with the original id, same #700001), 10 (poll again → same `102`), 11 (wrong token → `98`).
- Not run, because the test business's type is unknown: 1, 2, 8 (InvoiceReceipt / Invoice), 12. No allocation number was returned for any Receipt.

## 4. Questions still open with SmartBee

From the 2026-11-10 audit: what the connection code is exactly; whether a token can be revoked; rate limits; whether the test server sends real emails or requests real allocation numbers; the allocation threshold and how "not required" differs from "failed"; Bit/PayBox mapping and `otherItems.description` length; `pricePerUnit`/`quantity` maximums; whether documents can be found by `providerMsgId`.
