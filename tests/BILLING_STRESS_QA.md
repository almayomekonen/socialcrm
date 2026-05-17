# Billing — Destructive QA Checklist

Scope: scenarios that pure unit tests can't exercise — real DB races, real PDF rendering, real email delivery, two-tab concurrency, snapshot integrity across mutation.

Companion to `__tests__/billing/*.stress.test.ts` (134 automated assertions covering payment validation, totals precision, numbering display, HTML rendering). The automated suite is the first line; this checklist is the second.

For every failure capture: **input → action → observed result → expected result → screenshot/dump**. Treat each section as a separate ticket if it fails.

Set-up: 2 browser profiles (or browser + incognito) signed in as the same admin. A real lead with a verified email you control. Resend dashboard open in a third tab.

---

## A. Snapshot integrity (legal/regulator-relevant)

Goal: prove that mutating live agency/customer/tax data post-issuance does NOT alter a previously-issued invoice's PDF, email, or stored content.

### A1 — Mutate agency identity after issue

1. Issue invoice X for lead L. Wait for PDF to render. Download the PDF; save as `X-before.pdf`.
2. Settings → Agency → change `name`, `taxId`, `address`, `phone`, `email` to obviously different values.
3. From the issued invoice page click **"רנדר מחדש PDF"** (rerender).
4. Download the new PDF; save as `X-after.pdf`.

**Expected:** `X-before.pdf` and `X-after.pdf` show **identical** issuer name, tax ID, address, phone, email. The agency mutation must NOT bleed into historical document.

**Pass criteria:** `diff <(pdftotext X-before.pdf -) <(pdftotext X-after.pdf -)` shows no issuer field changes.

**Severity if fail:** CRITICAL — regulator-relevant immutability breach.

### A2 — Mutate customer billing profile after issue

1. Issue invoice X for lead L.
2. Edit L's billing profile (`legalName`, `taxId`, `address`).
3. Click rerender on invoice X.

**Expected:** Original recipient snapshot rendered unchanged. The lead's NEW profile data must not leak.

**Severity if fail:** CRITICAL.

### A3 — Mutate tax rate after issue

1. Issue invoice X with VAT 18%.
2. Settings → bump VAT rate to 17%.
3. Rerender invoice X.

**Expected:** Lines still show 18%, original subtotal/tax/total unchanged. New rate only affects NEW drafts.

**Severity if fail:** CRITICAL — line-level `taxRatePercentSnapshot` must be the source of truth.

### A4 — Mutate payment snapshot fields after issue

Try to UPDATE `bill_invoices.paymentMethod`, `paymentAmount`, `paymentDate`, `paymentMethodSnapshot`, `paymentAmountSnapshot`, `paymentDateSnapshot` for an already-issued combined invoice via raw SQL. The DB `bill_invoices_invoice_receipt_payment_invariants` CHECK should reject any change that would put the snapshot in an inconsistent state.

```sql
UPDATE bill_invoices
SET "paymentMethodSnapshot" = ''
WHERE id = <X> AND "docState" != 'draft';
```

**Expected:** The CHECK constraint blocks the UPDATE.

**Severity if fail:** HIGH — application-layer immutability is the only guard, defense in depth gone.

### A5 — Mutate `customerFooter` after issue (defense-in-depth gap)

```sql
UPDATE bill_invoices SET "customerFooter" = 'leaked' WHERE id = <X>;
```

**Expected today:** This UPDATE succeeds (no DB-level guard). The cached PDF is unchanged (stored bytes), but a rerender would pick up "leaked".

**Documented weakness — not currently blocked.** See `bill_invoices_post_draft_invariants` CHECK — it covers `documentNumber/year/issuedAt/issuedByUserId/fulfillState` but not user-content fields.

**Severity:** MEDIUM — application code doesn't trigger this, but lack of a DB guard is a real defense-in-depth gap.

---

## B. Concurrency / race conditions

### B1 — Double-click issue (single tab)

1. New invoice editor with 1 line.
2. Click "הנפק חשבונית" → confirm dialog → click "הנפק חשבונית" **5× in 200ms**.

**Expected:** Exactly ONE document number allocated. Page navigates to one issued invoice. Numbering sequence advances by 1, not 5.

**Verify:** Re-issue another invoice; document number should be N+1 vs the issued one above, with no gap.

**Severity if fail:** HIGH — gap-free numbering invariant violated.

### B2 — Two tabs issuing the SAME draft

1. Save a draft invoice (so it exists at `/billing/<id>`).
2. Open `/billing/<id>` in Tab A and Tab B.
3. In each tab, click "הנפק חשבונית" → confirm — **stagger by ~100ms**.

**Expected:** One tab succeeds with the document number; the other returns `not_draft` error and toast "החשבונית כבר הונפקה". No two invoices share a number.

**Verify:** Tab B's error toast shows the new wording (not silent). User can refresh and sees the frozen view.

**Severity if fail:** CRITICAL.

### B3 — Two tabs creating a NEW invoice for the same lead

1. Tab A: open `/clients/L/billing/new`, add a line. **Do not save.**
2. Tab B: open `/clients/L/billing/new`. Observe whether sessionStorage hydration pulls Tab A's draft.
3. Both tabs: click "הנפק חשבונית" simultaneously.

**Expected current behaviour:** Each tab creates a SEPARATE draft and issues it. You end up with two issued invoices for the same logical intent. **This is a known weakness** — `saveAndIssueTransientAction` always creates a new draft.

**Mitigation suggestion:** Once the first tab gets `invoiceId` back, the second click should target THAT id (idempotency by transient session). Not currently implemented.

**Severity:** HIGH — easy to trigger by impatient users.

### B4 — Two tabs sending the SAME issued invoice

1. Issue invoice X. PDF ready.
2. Open the issued page in Tab A and Tab B.
3. Click "שלח חשבונית" in both, enter the same recipient, submit within ~100ms of each other.

**Expected today:** Both succeed and the customer receives TWO emails. The cooldown check (30s) is a read-then-write race — neither tab sees the other's SENT event yet.

**Severity:** HIGH — customer-visible.

**Fix direction:** unique index `(invoiceId, eventType, recordedAt-truncated-second)` or attempt the cooldown check inside a transaction that also writes the SENT event.

### B5 — Issue while PDF render is still pending from a prior version

Edge: after Phase 1 timeout work, a render row in `'rendering'` can no longer get stuck indefinitely (30s launch + 30s setContent + 30s pdf = 90s max). Verify:

1. Disable network in DevTools (so Chromium can't fetch any external resource).
2. Trigger an issuance.
3. Wait 90+ seconds.

**Expected:** `bill_documents.status` transitions to `'failed'` with `errorReason` = `render_error` or `font_missing`. "Rerender PDF" button appears. **No row stays at `'rendering'` past 90s.**

**Severity if fail:** HIGH — the bug that prompted the timeout work.

---

## C. Financial integrity

### C1 — KNOWN BUG: small-line VAT overcharge

Captured by automated test `BUG: 100 small lines (0.10 @ 18%) overcharge by 0.20 ₪`. Manual reproduction:

1. New combined invoice/receipt.
2. Add 100 line items, each: title "x", quantity 1, unit price **0.10**.
3. Observe totals.

**Expected (mathematically correct):** subtotal 10.00, VAT 1.80, total 11.80.

**Today's behaviour:** subtotal 10.00, VAT 2.00, total 12.00. **Customer is overcharged 0.20 ₪.**

**Severity:** HIGH (CRITICAL if the user issues many such invoices to the same customer — recurring overcharge).

**Fix direction:** invoice-level VAT must be computed once as `round2(subtotalSum × rate)`, not as the sum of per-line rounded taxes. Per-line displayed tax can stay rounded for the UI; the legal tax line on the document must come from the subtotal sum.

### C2 — Partial payment correctness

1. Combined invoice total 100.00.
2. Set paymentAmount = 50.00, paymentMethod = cash, paymentDate = today.
3. Issue.

**Expected:** `fulfillState = 'partial'`, `outstandingAmount = 50.00`, receipt block on PDF shows 50.00 paid.

### C3 — Exact-cent payment

1. Total 99.99, paymentAmount = 99.99.

**Expected:** `fulfillState = 'paid'`, `outstandingAmount = 0.00`.

### C4 — Overpayment

1. Total 100.00, paymentAmount = 100.01.
2. Try to issue.

**Expected:** Issue button disabled OR server returns `payment_exceeds_total` with toast "הסכום שהתקבל לא יכול להיות גבוה מסכום המסמך". **Customer never charged more than total.**

### C5 — Zero-total invoice issue attempt

1. Add a line with quantity 1, unit price 0, discount 0.
2. Try to issue.

**Expected:** `zero_total` error with toast. No invoice issued.

### C6 — Discount larger than line price

1. Add a line: qty 1, price 50, discount 999.
2. Observe.

**Expected:** Line subtotal clamps to 0, tax 0, lineTotal 0. No negative line allowed. (Automated: `discount larger than subtotal clamps to zero`).

### C7 — Numbering year boundary (UTC vs Israeli local time)

Edge case: invoice issued at 23:30 Israel time on December 31. UTC time is 21:30 December 31. `documentYear = issuedAt.getUTCFullYear() = year X`. Then at 02:30 Israel time January 1 (UTC 00:30 Jan 1), `documentYear = X+1`. **Two adjacent invoices spanning Israeli new year can have different document years**.

**Severity:** MEDIUM — surprising for users but mathematically consistent (sequence resets on UTC year boundary). Document the convention or switch to Israeli locale year if business prefers.

---

## D. PDF / RTL torture

### D1 — Long Hebrew customer name

1. Issue invoice with `legalNameSnapshot` = a 200-character Hebrew string.
2. Open PDF.

**Expected:** Name wraps within the recipient block without spilling out of the page. No truncation, no overlap with column on the left.

### D2 — Mixed Hebrew + English in line title

1. Line title: `"שירות SEO + ניהול קמפיין"`.
2. Issue.

**Expected:** Mixed bidi renders correctly in the line column. "SEO" stays LTR within the surrounding RTL Hebrew.

### D3 — Emoji in customer footer

1. Customer footer: `"תודה רבה! 🙏✓ נשמח לראותכם שוב 🚀"`.
2. Issue.

**Expected:** Emoji glyphs render (Chromium falls back to system emoji font). No tofu boxes. Footer reads naturally.

**If fail:** Chromium-min may lack emoji glyphs in headless mode. Workaround: embed Noto Color Emoji.

### D4 — Multiline line description

1. Line description with embedded newlines: `"שורה 1\nשורה 2\nשורה 3"`.
2. Issue.

**Expected:** Each line on its own row in the description sub-text. Hebrew RTL maintained.

### D5 — Numbers inside Hebrew text

1. Customer footer: `"חשבון מס׳ 12345 לתאריך 18/05/2026 על סך 354 ₪"`.
2. Issue.

**Expected:** Numbers appear in LTR order (12345, not 54321). Date in DD/MM/YYYY order. ₪ to the right of the number per Hebrew convention.

### D6 — PDF text-layer copy/paste

1. Issue an invoice.
2. Open in Adobe Reader (or Preview / Chrome / iOS / Android PDF viewer).
3. Select all text and copy.
4. Paste into a text editor.

**Expected:** Hebrew text is copy-pasted in **logical order** (so when pasted into another Hebrew context it reads correctly). The pre-Phase-1 character-reversed PDF would have produced reversed gibberish on paste — this is the main migration validation point.

### D7 — PDF text search

1. Open the issued PDF in a PDF viewer.
2. Use the viewer's find-in-document (Cmd+F) to search for "חשבונית".

**Expected:** Match found, highlighted. Pre-migration PDFs would have NO matches because the text layer was reversed.

### D8 — Mobile PDF viewer (iOS / Android)

1. Email the PDF to a real mobile device.
2. Open in the device's default PDF viewer.

**Expected:** Layout intact. Hebrew readable. No font fallback to a non-Hebrew face. Numbers tabular and aligned.

### D9 — Very large invoice (200+ lines)

1. Programmatically create a draft with 200 line items (use a script against the action layer or paste-import).
2. Issue.

**Expected:** PDF renders in <10s. Multi-page output with header repeated on page 2+. No memory crash. Totals correct.

**Documented limitation:** Current renderer has no explicit page-break/header-on-page-2 styling — it relies on Chromium's natural CSS table pagination. Manual review the output.

---

## E. UX failure-state visibility

Every error path must produce a CLEAR Hebrew toast that explains WHY. No silent failures.

| Scenario | Trigger | Expected toast |
|---|---|---|
| `payment_exceeds_total` | Type paymentAmount > total | `הסכום שהתקבל לא יכול להיות גבוה מסכום המסמך` |
| `payment_incomplete` | Click issue with missing method/date | `יש להשלים את פרטי התשלום` |
| `issuer_identity_incomplete` | Click issue when agency has no taxId | `יש להשלים את פרטי העסק` (or modal opens) |
| `invalid_email` | Send to "asdf" | `הנתונים שהוזנו אינם תקינים` or send-modal client validation |
| `transport_failed` | Send when Resend is down | `שליחת החשבונית נכשלה` |
| `pdf_not_ready` | Send before PDF renders | error toast; UI offers "Rerender PDF" if status is `'failed'` |
| `rate_limited` | Send twice within 30s | error toast (currently generic — could specify cooldown remaining) |
| `not_draft` | Issue a draft that was just issued in another tab | error toast (B2) |

**Pass:** every trigger above produces a visible Hebrew toast in <2s.

**Fail:** any silent navigation or silent no-op.

---

## F. Autosave / recovery

### F1 — Refresh mid-issue

1. Fill new invoice with 3 lines. Click issue, then F5 within 200ms.
2. On reload, observe the new-invoice page.

**Expected one of two outcomes, never partial:**
- Issuance completed → user lands on the issued page eventually.
- Issuance didn't complete → user lands back on `/billing/new`, sessionStorage hydrates the 3 lines, draft NOT saved server-side.

**Fail criteria:** an issued invoice with no lines, or a draft with no lines that the user can't recover.

### F2 — Close tab mid-draft

1. Type 5 lines in `/billing/new`. Don't save.
2. Close the tab.
3. Reopen `/clients/L/billing/new`.

**Expected:** sessionStorage hydrates with the 5 lines.

### F3 — Multi-user on same browser (KNOWN WEAKNESS)

1. User A logs in, fills `/clients/L1/billing/new` with sensitive line titles. Don't save. Log out.
2. User B logs in to the same browser, navigates to `/clients/L1/billing/new`.
3. Observe.

**Expected behavior (today):** Tab B's sessionStorage hydration may load User A's typed values, because the storage key is `billing.new.draft.lead_${leadId}` — not scoped to user.

**Severity:** HIGH for multi-user kiosk scenarios. Privacy leak.

**Fix direction:** Include `userId` in the sessionStorage key, and clear all `billing.new.draft.*` keys on logout.

### F4 — Stale draft recovery after server-side draft already exists

1. Save a draft. Land on `/billing/<id>`.
2. Open a second tab to `/billing/new` for the same lead. sessionStorage may still have stale state from before.

**Expected:** Recovered state, when paired with the draft already on the server, doesn't produce a phantom duplicate.

---

## G. Permissions / security

### G1 — Cross-agency invoice URL

1. From agency A, get an issued invoice ID and copy the URL.
2. Sign in as agency B's admin.
3. Paste the URL `/clients/<L>/billing/<id>`.

**Expected:** Page returns NotFound. The invoice's `agencyId` filter blocks access. No data leak.

### G2 — Non-admin attempts issue via direct action call

1. Sign in as MNGR or AGNT.
2. Open DevTools console on a draft page.
3. Call `await fetch('/...', { /* server action payload */ })` with the issue action and a stolen invoiceId/leadId.

**Expected:** `no_permission` returned. No invoice issued.

### G3 — Direct DB UPDATE on an issued invoice's number

```sql
UPDATE bill_invoices SET "documentNumber" = 99999 WHERE id = <X>;
```

**Expected today:** The UPDATE succeeds (no DB lock on documentNumber). The unique index `bill_invoices_agency_year_number_uniq` will reject if you collide with another issued row.

**Severity:** MEDIUM — application never does this, but defense-in-depth gap.

### G4 — Send modal recipient field accepts HTML

1. Send modal, recipient: `<script>alert(1)</script>@x.com`.
2. Click send.

**Expected:** Client `isValid` regex rejects. Server's `isValidEmail` also rejects.

---

## H. HTML preview / PDF / email consistency

### H1 — HTML preview == PDF == email attachment

1. Render `renderInvoiceHtml(...)` directly (test fixture or one-off route) and save as `preview.html`.
2. Issue the same invoice, render to PDF.
3. Send the email; open the email attachment.
4. Compare side-by-side: title, identity, recipient, line items, totals, receipt block, footer.

**Expected:** All three are visually equivalent. The only acceptable differences are anti-aliasing and PDF text-layer specifics.

### H2 — Email subject vs body identity

1. Send invoice X.
2. Open the inbox.
3. Subject should be `חשבונית/קבלה #00003 מ-<agency>` (or plain חשבונית for non-receipt).
4. Body should reference `המסמך #00003` (per Phase 2.6 wording).

### H3 — Audit log retains the long-form number

```sql
SELECT payload->>'documentNumber' FROM bill_financial_events WHERE "invoiceId" = <X>;
```

**Expected:** `INV-2026-00003` (long form). This is intentional — the audit trail uses the canonical/legal form, never the branded short form.

---

## Quick-triage order (90 minutes)

If time-constrained, run in this order:

1. **C1** — VAT overcharge bug. Confirm or refute against your real data.
2. **A1, A2, A3** — Snapshot integrity. Regulator-relevant.
3. **B1, B2, B4** — Concurrency. Customer-visible duplication.
4. **D6, D7** — PDF text layer. Validates the whole Phase 1 migration.
5. **F3** — Multi-user autosave leak.
6. **E (all)** — Toast visibility for every error reason.
