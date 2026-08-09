# Quotations — Architecture Audit & Design

**Status:** proposal. No code written. Supersedes nothing.
**Scope:** add a first-class Quotation (`הצעת מחיר`) entity that belongs to Leads, reuses
the existing document/PDF/timeline/permission infrastructure, and stays a **sales** entity —
never an accounting record.

**Reading order:** §1 audit → §2 gaps → §3 schema → §4 API → §5 UI → §6 automations →
§7 AI → §8 risks → §9 roadmap. §0 lists the assumptions in the brief that the code contradicts.

---

## 0. Assumptions in the brief that the repository contradicts

Four corrections up front, because three of the nine deliverables were framed against
infrastructure that does not exist in this codebase.

| Brief assumed                                         | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Consequence                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Prisma schema**                                     | There is no Prisma. Zero dependencies, zero `schema.prisma`, zero imports. The stack is **Knex 3** + `pg`, raw-SQL migrations in `migrations/*.cjs`, hand/kanel-maintained types in [types/db/tables.ts](types/db/tables.ts) and [types/db/knex.d.ts](types/db/knex.d.ts).                                                                                                                                                                                                                                                                                                                                                     | §3 is delivered as Knex migrations + TS row types, not a Prisma model.                                                  |
| **Drawers** exist as a UI pattern                     | They do not. The only dialog primitives are [ModalPop.tsx](lib/modals/ModalPop.tsx) (portal + focus trap + ESC + focus restore) and [ConfirmPop.tsx](lib/modals/ConfirmPop.tsx). Even the file _named_ `AutomationSheet.tsx` is a `ModalPop`.                                                                                                                                                                                                                                                                                                                                                                                  | No drawer for quotes. Full page for the editor, `ModalPop` for send/confirm — exactly the invoice pattern.              |
| Quotes are greenfield                                 | [lib/billing/documentKinds.ts:52-58](lib/billing/documentKinds.ts#L52-L58) already ships a **disabled** `quote` entry — `הצעת מחיר`, `enabled: false`, `routeKind: null` — rendered as a "בקרוב" row in the live [DocumentKindPicker](components/billing/document-picker/DocumentKindPicker.tsx). The AI layer already emits `send_quote` as a suggested action ([conversationAnalysis.ts:25](lib/ai/prompts/conversationAnalysis.ts#L25)), ranks it #6 in inbox sorting ([modules/inbox/queries.ts:27](modules/inbox/queries.ts#L27)), and labels it `שלח הצעת מחיר` ([intelLabels.ts:24](modules/inbox/intelLabels.ts#L24)). | The entry point, the picker, and the AI trigger are **already built and wired**. This feature is smaller than it looks. |
| Lifecycle includes `Viewed` and `Converted` as states | Both are events/relations, not states — see §3.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Recommended model uses 7 statuses + timestamp/FK columns, and renders all 9 lifecycle steps in the UI.                  |

---

## 1. Repository audit

### 1.1 Billing / invoice architecture

Four layers, strictly separated, and the separation is load-bearing:

```
components/billing/*   UI only. No knex, no requireUser.
actions/billing/*      'use server'. Auth + perms + orchestration. Returns typed results.
lib/billing/*          Pure logic. No I/O. Client-importable (totals.ts says so explicitly).
db/billing/*           Knex. Every read/write scoped by requireUser().agencyId.
```

**Eight tables**, all `bill_`-prefixed, all created additively:

| Table                      | Role                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bill_billing_profiles`    | Legal billing identity per `(agencyId, leadId)`. Partial-unique on `state='active'`. Explicitly documented as _"not a second customer entity"_.                                       |
| `bill_tax_rates`           | Versioned VAT. New rate = new row, never an UPDATE. Seeded 18% IL per agency.                                                                                                         |
| `bill_numbering_sequences` | Composite PK `(agencyId, year, kind)`, `kind IN ('invoice','receipt')`. `SELECT … FOR UPDATE` is the only legal allocation path.                                                      |
| `bill_invoices`            | Header. Holds mutable drafts **and** immutable issued rows; behaviour gated by `docState`. ~50 columns incl. recipient snapshot, issuer snapshot, payment snapshot, projection cache. |
| `bill_invoice_lines`       | Frozen child rows. `taxRateId` FK **and** `taxRatePercentSnapshot`. Persisted `lineSubtotal`/`lineTaxAmount`/`lineTotal`.                                                             |
| `bill_invoice_versions`    | Draft autosave history. Explicitly _not_ legal versioning. `ON DELETE CASCADE`.                                                                                                       |
| `bill_financial_events`    | Append-only activity spine. See §1.4.                                                                                                                                                 |
| `bill_documents`           | Rendered PDF artifacts. See §1.2.                                                                                                                                                     |

**Two-axis state machine** ([20260513000002](migrations/20260513000002_create_bill_invoices.cjs)):

- `docState ∈ {draft, issued, voided, replaced}` — legal lifecycle
- `fulfillState ∈ {open, partial, paid, overdue, written_off}` — money projection, `NULL` for drafts

Enforced in the database, not just the app:

```sql
CONSTRAINT bill_invoices_post_draft_invariants CHECK (
  "docState" = 'draft'
  OR ("documentNumber" IS NOT NULL AND "documentYear" IS NOT NULL
      AND "issuedAt" IS NOT NULL AND "issuedByUserId" IS NOT NULL
      AND "fulfillState" IS NOT NULL)
)
```

**This constraint is the single most important fact in the audit.** Any non-draft invoice row
_must_ carry a legal number, an issue timestamp, an issuer, and a money state. A quote that is
"Sent" has none of those. This is why quotes cannot be `bill_invoices` rows — see §3.1.

**Issuance** ([db/billing/issueInvoice.ts](db/billing/issueInvoice.ts)) is one transaction:
`FOR UPDATE` the invoice → validate → resolve effective tax rate from live `agencies.businessType`
(עוסק פטור ⇒ 0%) → group-VAT totals → allocate number under row lock → freeze snapshots →
append `invoice.issued` event → schedule PDF. `kind = 'invoice_receipt'` additionally validates
and freezes payment fields and emits `payment.received`.

**Money arithmetic** lives in [lib/billing/totals.ts](lib/billing/totals.ts) — pure, no I/O,
client-importable by design. `computeInvoiceLegalTotals` computes group VAT once per rate and
distributes the cents-rounded share with the residual on the last line, so `sum(lineTotal)`
equals the header total exactly. **Fully reusable for quotes, unchanged.**

### 1.2 PDF generation pipeline

Externalised to **Gotenberg** in webhook mode. The PDF bytes never touch the Vercel runtime.

```
scheduleInvoicePdfRender(invoiceId, agencyId, force?)      lib/billing/pdf/schedule.ts
  ├─ hasReadyDocument()? → skip unless force
  ├─ predict S3 key:  bill/{agencyId}/invoice/{invoiceId}/{genId}.pdf
  ├─ createPendingDocument()   → bill_documents row, status='rendering', path/url pre-filled
  └─ after(() => dispatchRender())                          next/server `after`
        ├─ load bill_invoices + bill_invoice_lines
        ├─ getIssuerForRender() + resolveIssuerForRender()
        ├─ getSignedUrl(PutObjectCommand)  → 5-min presigned PUT
        └─ renderInvoicePdf()                                lib/billing/pdf/renderInvoicePdf.ts
              ├─ renderInvoiceHtml()                         html/InvoiceTemplate.tsx
              │    dynamic import('react-dom/server') → renderToStaticMarkup
              │    DocumentHeader · RecipientBlock · LinesTable · TotalsPanel
              │    · ReceiptPanel · DocumentFooter   (+ styles.ts tokens, fontEmbed.ts)
              └─ dispatchHtmlToPdf()                         html/renderHtmlToPdf.ts
                     POST /forms/chromium/convert/html
                     Gotenberg-Webhook-Url: <presigned PUT>  → S3 eu-north-1
                     Gotenberg-Webhook-Error-Url: /api/billing/render-error
```

**Completion is observed, not pushed.** A client poller calls
[`getInvoicePdfStatusAction`](actions/billing/documentStatus.ts), which does S3 `HeadObject`
on the predicted key; if the object landed it flips the row to `ready` (ETag → `contentHash`),
if the row is older than 5 minutes it flips to `failed('render_timeout')`.
[InvoicePdfLive.tsx](components/billing/InvoicePdfLive.tsx) drives it.

**Two exits:**

- Authenticated: `GET /api/billing/invoice/[invoiceId]/download` → auth + agency + `getPerms`
  lead check → 60s presigned GET with RFC-5987 `Content-Disposition` → 302.
- Public: the send email embeds `document.url`, which is
  `https://socialcrm-storage.s3.eu-north-1.amazonaws.com/<path>` — an **unguessable but
  unauthenticated** object URL ([config/s3.ts:11](config/s3.ts#L11)).

**Reusability verdict:** the _transport_ (Gotenberg → presigned PUT → S3 → HeadObject poll →
render-error callback) is entity-agnostic and reusable as-is. The _entry points_ are
invoice-shaped at three points: the `bill_documents.invoiceId NOT NULL` FK, the hardcoded
`bill_invoices`/`bill_invoice_lines` loads in `dispatchRender`, and `RenderInvoicePdfInput`
being typed to `BillInvoiceRow`. See §2.1.

### 1.3 Existing reusable entities

| Entity                                                                       | Reusable for quotes?          | Note                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `clients` (**the** Lead; only customer entity) + `clients_info`              | **Yes — owner**               | `nextFollowUpAt`, `followUpNote`, `lastActivityAt`, `lastOutcomeType`, `status` |
| `bill_tax_rates` + `resolveActiveTaxRateForLine` + `effectiveTaxRatePercent` | **Yes, as-is**                | Business-type policy already handles עוסק פטור                                  |
| `lib/billing/totals.ts`                                                      | **Yes, as-is**                | Pure, client-importable, group-VAT correct                                      |
| `agencies` issuer columns + `getIssuerForRender` + `resolveIssuerForRender`  | **Yes, as-is**                | Same sender identity on quote and invoice                                       |
| `bill_numbering_sequences` + `allocateNumberInTransaction`                   | **Yes, with a widened CHECK** | See §3.5 for the trade-off                                                      |
| `bill_billing_profiles`                                                      | **No — deliberately not**     | Legal identity. A quote must not require one; §3.2                              |
| `bill_invoices` / `bill_invoice_lines`                                       | **No**                        | The post-draft CHECK forbids it; §3.1                                           |
| `users`, `user_perms`, `user_teams`                                          | **Yes, as-is**                | §1.6                                                                            |
| `files`, `lead_drive_files`                                                  | Adjacent                      | §1.5                                                                            |
| `tasks`, `meetings`, `inbox_conversations`                                   | Adjacent                      | Signals, not storage                                                            |

### 1.4 Activity / Timeline infrastructure

`bill_financial_events` is the only real timeline in the product, and it was designed to be
extended. From its own migration header:

> _"Entity references use real nullable FKs, not (entityKind, entityId) polymorphism.
> **Future entities (receipts, allocations) get their own nullable FK columns added
> additively.**"_

Shape: `invoiceId?` + `leadId?` nullable FKs (CHECK: at least one set), `actorUserId` +
`actorKind ∈ {user, system, webhook, projection}`, hierarchical `eventType` string,
`visibilityTier ∈ {user, system, audit}`, `occurredAt` (fact time) vs `recordedAt` (insert time),
`payload jsonb`, partial-unique `idempotencyKey`. Append-only — `db/billing/events.ts` exports
no mutating function beyond `appendFinancialEvent`, which accepts an optional `Knex.Transaction`.

Visibility is _inferred by prefix_ ([visibility.ts](lib/billing/events/visibility.ts)) with an
unknown-type fallback of `'system'`, so accidental UI leakage requires deliberate opt-in.
`USER_VISIBLE_PREFIXES` already lists `communication.` and `reminder.` alongside `invoice.`.

**Two indexes matter for quotes:** `(agencyId, invoiceId, occurredAt DESC) WHERE invoiceId IS NOT NULL`
and `(agencyId, leadId, occurredAt DESC) WHERE leadId IS NOT NULL`. The second one is currently
**unused by any UI** — `listLeadFinancialEvents` exists, nothing renders it. A lead-level
timeline is one component away.

Renderer: [InvoiceTimelineList.tsx](components/billing/InvoiceTimelineList.tsx) — 84 lines,
a `switch` over `eventType` producing Hebrew sentences, `default: return event.eventType`.

**Elsewhere:** automation activity log (`db/automations/activity.ts`), lead activity stamps
(`recordLeadActivity`), analytics events (`analytics_events`). None is a user-facing timeline.

### 1.5 Attachments

Three unrelated stores, no polymorphic attachment table:

1. **`files`** — S3 uploads, columns `clientId`/`taskId`/`agencyId`/`createdById`. Rendered by
   `ClientFilesTable`. Generic but lead/task-shaped only.
2. **`lead_drive_files`** — Google Drive references (`drive_file_id`, `web_view_link`),
   `snake_case` (the one table that breaks the camelCase convention), upsert on
   `(lead_id, drive_file_id)`.
3. **`bill_documents`** — rendered PDF artifacts. Append-only rows + `isCurrent` partial unique.
   `kind IN ('invoice_pdf','receipt_pdf','statement_pdf')`, `status: rendering → ready|failed`,
   `contentHash` (SHA-256/ETag), `byteSize`, `errorReason`.

**For quote PDFs the correct store is `bill_documents`** — it is the only one that models
render lifecycle, versioning, and integrity. `files` would require re-implementing all of it.

### 1.6 Permissions

Two orthogonal axes, both already correct for quotes:

**Role** ([types/roles.ts](types/roles.ts)): `ADMIN, GM, MNGR, AGNT, OFFICE, EXT`.
`isAdmin = {ADMIN, GM}`, `isMngr = {MNGR, ADMIN, GM}`.

**Lead visibility** ([db/filter.ts `getPerms`](db/filter.ts)): admins see all; everyone else gets
`gotPermIds` = self ∪ `user_perms.gaveId → gotId` ∪ (for `MNGR`) team members via `user_teams`.

**Billing predicates** ([lib/billing/permissions.ts](lib/billing/permissions.ts)) — pure functions
over `user.role`, no new auth model:

```ts
canReadBilling  → true (narrowed later by lead-level perms)
canDraftBilling → role !== EXT
canIssueBilling → isMngr(role)
```

**Guards:** `requireUser()` (session + not suspended + has agency) vs `requireProductAccess()`
(adds the trial/subscription boundary, throws `ProductAccessError`). Billing pages use
`requireUser`; billing _actions_ and the download route use `requireProductAccess`.

**Observed duplication:** this exact block is copy-pasted in at least five places
(`billing/page.tsx`, `billing/[invoiceId]/page.tsx`, `billing/new/page.tsx`,
`actions/billing/send.ts`, the download route):

```ts
const { gotPermIds } = await getPerms(user)
const q = db('clients').where({ id: leadId, agencyId: user.agencyId })
if (!isAdmin(user.role)) q.whereIn('userId', gotPermIds)
const lead = await q.first('id')
if (!lead) notFound()
```

A known cross-agency IDOR already exists on the lead-detail layout route (tracked, deliberately
not fixed in the last deploy). **Quotes must not add a sixth copy** — §2.5.

### 1.7 Notifications

| Channel              | Implementation                                                                                                                                      | Reusable for quotes                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| In-app toast         | [lib/toast.tsx](lib/toast.tsx) — singleton `popover` element, icons `success/error/loading/ban/hide/message`, `aria-live` polite region, 3s default | Yes                                                 |
| Customer email       | `lib/email/sender.ts` (Resend) + `@react-email` templates in `emails/templates/`                                                                    | Yes — clone `InvoiceSentEmail` → `QuoteSentEmail`   |
| WhatsApp             | `lib/whatsapp/sendMessage.ts`, `sendTemplateMessage.ts`, `whatsapp_templates`                                                                       | Yes, but 24h-window + template-approval constraints |
| Platform lifecycle   | [lib/events/emit.ts](lib/events/emit.ts) → Resend events. Two types only: `user.registered`, `user.meta_connected`                                  | Not applicable (platform-side)                      |
| Customer automations | [lib/automations/emit.ts](lib/automations/emit.ts) → job queue → worker                                                                             | Yes — §6                                            |

There is **no in-app notification center**. Do not build one for quotes.

### 1.8 Status machines — the house pattern

Every status machine in the codebase follows the same shape, and quotes must too:

1. Postgres `text` column + `CHECK (col IN (...))` — never a PG `enum` type
2. A TS union type mirroring it in the `db/` row type
3. A label/style registry in a TS module (`STATUS_STYLES`, `DOCUMENT_KINDS`, chips)
4. Values are **append-only persisted data**; renames are migrations

| Machine         | States                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lead            | `new · contacted · interested · closed · lost` ([LeadStatusCell.tsx](components/clients/LeadStatusCell.tsx), mirrored as catalog data in [automations events.ts](lib/automations/catalog/entries/events.ts)) |
| Invoice legal   | `draft · issued · voided · replaced`                                                                                                                                                                         |
| Invoice money   | `open · partial · paid · overdue · written_off` (NULL for drafts)                                                                                                                                            |
| Document render | `rendering · ready · failed`                                                                                                                                                                                 |
| Meeting         | `scheduled · cancelled · completed · no_show`                                                                                                                                                                |
| Billing profile | `active · archived`                                                                                                                                                                                          |

### 1.9 Existing UI patterns

- **Dialogs:** `ModalPop` (portal, focus trap, ESC, focus restore, dev warning if unnamed),
  `ConfirmPop` (destructive variant + busy lock). **No drawer, no sheet, no popover panel.**
- **Tables:** two families. `lib/table/` (`THead`/`TBody`/`Search`/`ShowColumns`/`TableFooter`/
  `export`) for the big leads/sales grids; a plain semantic `<table>` for scoped lists —
  [LeadBillingList.tsx](components/billing/LeadBillingList.tsx) is the exact 94-line precedent a
  quote list should copy. `components/ui/table.tsx` is marketing-only.
- **Buttons:** [lib/btns/Btn.tsx](lib/btns/Btn.tsx) — `variant: solid | outline | destructive`,
  `icon` from the `@/lib/Icon` icon font, `lbl` required.
- **Forms:** `lib/form/` — `Input`, `Select`, `SelectSearch`, `MultiSelectSearch`.
- **Chips:** [components/billing/chips.tsx](components/billing/chips.tsx) — `DocStateChip`,
  `FulfillStateChip`.
- **Cards:** `components/ui/card.tsx`, `OnboardingActionCard` (registry-canonical per
  architecture-rules §10).
- **Lead sub-nav:** [ClientNav.tsx](components/clientPage/ClientNav.tsx) — a hardcoded
  4-item array: `summary · tasks · files · billing`.
- **Editor page shape** (the invoice precedent): full page, thin orchestrator, sticky action bar,
  live PDF pane, `ModalPop` for send/setup. `InvoiceNewEditor` 322 lines, `InvoiceDraftEditor`
  368 lines — **both already over the 250-line soft limit**; `InvoiceDraftEditor` is over the
  350-line hard limit.

### 1.10 API conventions

**Server Actions are the default.** `app/api/**/route.ts` is reserved for five things only:
OAuth callbacks, inbound webhooks (Facebook/WhatsApp/Gotenberg), Vercel cron, binary downloads
(presigned redirect), and `revalidateTag`.

Action contract — **typed results, not thrown errors**:

```ts
export type SendInvoiceResult = { success: true } | { error: true; reason: SendInvoiceErrorReason }
export type SendInvoiceErrorReason =
  | 'no_permission'
  | 'lead_not_found'
  | 'invoice_not_found'
  | 'invoice_not_issued'
  | 'pdf_not_ready'
  | 'invalid_email'
  | 'rate_limited'
  | 'transport_failed'
  | 'failed'
```

Other invariants: RSC pages do their own auth + `getPerms` + data load; `revalidatePath` after
mutation; heavy pages pin `maxDuration = 60` and `preferredRegion = 'arn1'`; structured
`console.log('[domain.op] stage', {...})` logging throughout; rate limiting is a
`bill_financial_events` lookback, not a store (30s send cooldown).

### 1.11 Database layer (not Prisma)

- **Runner:** `knex --knexfile knexfile.cjs migrate:latest` (`npm run migrate`), directory
  `./migrations`, extension `.cjs`. A second, legacy runner `scripts/migrate.cjs` reads
  `db/migrations/*.sql` (2 files, unrelated).
- **Types:** `types/db/tables.ts` (464 lines) + `types/db/knex.d.ts`; `kanel`/`kanel-knex` are
  devDependencies. Billing row types are hand-declared in `db/billing/*.ts` instead.
- **Naming:** quoted camelCase identifiers (`"agencyId"`, `"docState"`). `lead_drive_files` is
  the one snake_case exception — do not follow it.

### 1.12 Migration doctrine (from the billing migrations themselves)

1. Additive only. No existing column renamed, retyped, or dropped.
2. `CREATE TABLE IF NOT EXISTS` in `knex.raw` — not the schema builder.
3. Reversible `down()`, dropping in reverse FK order.
4. `ON DELETE RESTRICT` for anything that must outlive the referenced row.
5. State machines as `CHECK` constraints; cross-field invariants as named `CHECK`s.
6. Partial unique indexes for "at most one X per Y" (`WHERE state='active'`, `WHERE isCurrent`).
7. A prose header comment explaining doctrine and forward-compat.

**Enforcement gap (known, from prior work):** DB-backed integration tests fail repo-wide
because the test harness provisions base tables differently from `knex migrate`. The working
pattern is SQL-level assertions via `.toSQL()`. Quote tests must plan for this — §8.8.

### 1.13 Design system

Tailwind v4 (`@tailwindcss/postcss`), RTL Hebrew throughout, brand class `text-solid`,
icon **font** via `@/lib/Icon` (not `lucide-react`, which is marketing-only).
Hard rules from CLAUDE.md that bind this feature: **no emoji in UI**, **no invented components**,
**no new layouts**, `ליד`/`נציג` terminology, never `לקוח`/`סוכן`.

---

## 2. Gap analysis

What must be built or changed, ordered by how much it constrains the design.

### 2.1 The PDF pipeline is invoice-shaped at exactly three seams

Everything downstream of `renderInvoiceHtml` is generic. The coupling is:

| #   | Seam                                                                                                               | File                                                                                                   | Fix                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `bill_documents.invoiceId` is `NOT NULL REFERENCES bill_invoices(id)`                                              | [migration 20260513000004](migrations/20260513000004_create_bill_documents.cjs)                        | Add nullable `quoteId` FK; drop `NOT NULL` on `invoiceId`; add exactly-one-of CHECK; add sibling `isCurrent` partial unique on `quoteId`; widen `kind` CHECK with `'quote_pdf'` |
| 2   | `dispatchRender` hardcodes `bill_invoices`/`bill_invoice_lines` loads and the `bill/{agency}/invoice/{id}/` S3 key | [pdf/schedule.ts](lib/billing/pdf/schedule.ts)                                                         | Introduce a `DocumentSource` seam (see below). Invoice behaviour byte-identical.                                                                                                |
| 3   | `RenderInvoicePdfInput` is typed to `BillInvoiceRow` / `BillInvoiceLineRow`                                        | [renderInvoicePdf.ts](lib/billing/pdf/renderInvoicePdf.ts), `InvoiceTemplate.tsx` and its 6 components | Add a neutral view-model the invoice adapter and quote adapter both produce                                                                                                     |

**The seam.** Not a rewrite — a narrow interface the existing invoice path implements first,
verified unchanged, before any quote code exists:

```ts
type RenderableDocument = {
  agencyId: number
  entity: { kind: 'invoice'; id: number } | { kind: 'quote'; id: number }
  storagePrefix: string // bill/{agencyId}/invoice/{id} | quote/{id}
  legalTitle: string // "חשבונית מס/קבלה" | "הצעת מחיר"
  identity: string // "#00042"
  recipient: RecipientSnapshot
  issuer: IssuerData | null
  lines: RenderableLine[]
  totals: { subtotal: number; tax: number; rounding: number; total: number }
  footer: string
  extras?: { receipt?: ReceiptPanelData; validity?: { until: string; terms: string } }
}
```

`ReceiptPanel` stays invoice-only via `extras.receipt`; quotes add a validity/terms block. The
existing `DocumentHeader`/`RecipientBlock`/`LinesTable`/`TotalsPanel`/`DocumentFooter`,
`styles.ts` tokens and `fontEmbed.ts` are reused verbatim.

**Reusable with zero change:** `dispatchHtmlToPdf`, the presigned-PUT mechanics, the
`HeadObject` completion poll, `/api/billing/render-error` (it keys on `documentId` + `agencyId`
and never reads the invoice), `markDocumentReady`/`markDocumentFailed`.

### 2.2 `bill_financial_events` cannot reference a quote

Same additive fix the migration header anticipates: nullable `quoteId` FK + widened
`bill_financial_events_entity_required` CHECK + a `(agencyId, quoteId, occurredAt DESC)` partial
index. `defaultVisibilityFor` needs `'quote.'` in `USER_VISIBLE_PREFIXES` — otherwise quote
events silently fall through to `'system'` and never render.

### 2.3 There is no "customer viewed this" primitive

`bill_invoices.lastViewedAt` exists and **nothing ever writes it**. There is no public
customer-facing document route. Quote "Viewed" therefore requires genuinely new infrastructure:
a tokenized public route, a token column, and view-event recording. This is the largest net-new
surface in the whole feature and the one with real risk (§8.4). It is correctly deferred to a
late phase — every other lifecycle step works without it.

### 2.4 There is no scheduled evaluator for document state

The five cron routes are all messaging/AI (`analyze-conversations`, `automations-dispatch`,
`email-automations`, `send-auto-responses`, `whatsapp-template-sync`). Nothing sweeps billing.
**Do not add a cron for expiry in v1** — derive `expired` from `expiresAt < today` at read time
(§3.3). A materialising sweep is only needed when an _automation_ must fire on expiry (§6).

### 2.5 The lead-access check is duplicated five times

Adding quotes would make it eight. Extract once — `assertLeadAccess(user, leadId)` in
`lib/access/` — and have the quote surfaces be its first callers. Do **not** retrofit the
invoice call sites in the same change (that is invoice behaviour; separate PR).

### 2.6 No product/service catalog

There is no table of sellable items. Every quote line must be typed by hand, exactly as invoice
lines are today. This is acceptable for v1 and matches the invoice precedent, but it is the
single biggest limiter on the AI value in §7 — an AI cannot suggest a price it has no source
for, and inventing one violates care-charter Law 1.

### 2.7 Editor components are already over the size limits

`InvoiceDraftEditor.tsx` is 368 lines (hard limit 350), `InvoiceNewEditor.tsx` 322,
`actions/billing/drafts.ts` 373. Copy-pasting them into `components/quotes/` would ship two
files in immediate violation of [architecture-rules.md](claude/architecture-rules.md) §1.
The line editor (`lines/LineRow.tsx` 160, `lines/NewLineRow.tsx` 141, `lines/types.ts`) must be
lifted to a shared `components/documents/lines/` **before** the quote editor is written.

### 2.8 The automation catalog has no `quote` subject

Catalog-only gap, by design: `SUBJECT_ENTRIES` and the event registry are data. But
`TRIGGER_ORIGINS = ['webhook_facebook','webhook_whatsapp','webhook','manual','import']` has **no
scheduled origin**, so an expiry-triggered automation has nowhere honest to come from. Appending
`'scheduled'` is legal (the vocabulary is append-only) but it is a real vocabulary change, not
catalog data.

### 2.9 `ClientNav` is a hardcoded 4-tab array

A fifth tab is a product decision, not a code one. See §5.1.

---

## 3. Proposed database schema

### 3.1 The core decision: separate tables, not `bill_invoices.kind = 'quote'`

**Rejected: a `kind='quote'` row in `bill_invoices`.** Four independent reasons, any one
sufficient:

1. **It breaks the invoice's data-layer invariant.** `bill_invoices_post_draft_invariants`
   requires every non-draft row to carry `documentNumber`, `documentYear`, `issuedAt`,
   `issuedByUserId`, `fulfillState`. A _Sent_ quote has no issuance and no money state.
   Making it fit means weakening the constraint that protects every invoice in the system —
   a direct violation of _"do not modify invoice behavior"_ and of do-not-touch.md §7.
2. **`billingProfileId` is `NOT NULL`.** Quoting would require creating a legal billing identity
   for a lead who has not agreed to anything. Wrong, and it pollutes
   `bill_billing_profiles_active_per_lead_uniq`.
3. **`fulfillState` is meaningless.** A quote has no outstanding amount, no overdue, no write-off.
   `NULL` is already reserved for drafts, so quotes would need a third meaning for the same NULL.
4. **Accounting coupling is the stated anti-requirement.** Sharing the row means sharing the
   collections queries, the projection rebuilder, the fulfil-state indexes, the numbering
   uniqueness index, and every future `WHERE docState != 'draft'` sweep.

**Adopted: `sales_quotes` + `sales_quote_items`**, `sales_` prefix — the prefix _is_ the
statement that this is a sales entity. Reuse happens at the **infrastructure** layer
(`bill_documents`, `bill_financial_events`, `bill_tax_rates`, `bill_numbering_sequences`,
`lib/billing/totals.ts`, the PDF pipeline, permissions), never at the **record** layer.

### 3.2 What a quote deliberately does _not_ have

| Absent                                              | Why                                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billingProfileId`                                  | Recipient identity is snapshotted directly from the lead. No legal profile until invoicing.                                                              |
| `fulfillState`, `outstandingAmount`, payment fields | Not a financial record.                                                                                                                                  |
| `voided` / `replaced` states, `replacedByQuoteId`   | A quote is revised by editing (before send) or superseding (a new quote). No legal void chain.                                                           |
| Gap-free numbering guarantee                        | Quote numbers are display identifiers. No tax-authority obligation.                                                                                      |
| A versions table                                    | `bill_invoice_versions` exists because a draft invoice carries legal weight on the way to issuance. A quote draft does not. Add later only if users ask. |

### 3.3 Lifecycle — challenged and revised

Requested: `Draft → Ready → Sent → Viewed → Accepted / Declined / Expired → Converted to Invoice`.

**Three challenges:**

**(a) `Viewed` is an event, not a state.** As a status it is destructive: re-sending a viewed
quote has no correct status, and both "sent, unviewed" and "viewed" mean the same operational
thing — _awaiting the customer's decision_. Worse, corporate mail scanners prefetch links, so a
"Viewed" status would frequently be a **lie** — a care-charter Law 1 violation baked into the
schema. Model it as `firstViewedAt` / `lastViewedAt` / `viewCount` and render it as a secondary
badge on the `sent` row: `נשלחה · נצפתה`. `bill_invoices.lastViewedAt` already establishes this
column pattern.

**(b) `Converted` erases `Accepted`.** An accepted quote that has not yet been invoiced is a
**work item** — money the business has won and not yet billed. If conversion overwrites the
status, that queue disappears. Model conversion as `convertedInvoiceId` FK + `convertedAt`;
status stays `accepted`. The UI shows a distinct `הומרה לחשבונית` chip and links to the invoice.
This also makes "accepted quotes not yet invoiced" a one-line query — a genuinely useful
dashboard signal, and exactly the kind of unsolicited save care-charter Law 18 asks for.

**(c) `Ready` is worth keeping — but must not cost a second click.** It is not ceremony: it is
the point where content freezes, the number is allocated, and the async Gotenberg render is
dispatched. You physically cannot send before the PDF exists. Keep it in the model; in the UI a
single **`שלח הצעה`** button drives `draft → ready → (poll) → sent`, mirroring the existing
issue → `PostIssueSendBanner` → send flow. A separate `סמן כמוכנה` exists only for
prepare-now-send-later.

**Resulting status set** (7 values, append-only):

```
draft → ready → sent → accepted | declined | expired
                  ↑                    ↓
                  └──── (superseded by a new quote)
```

`expired` is **derived** in v1: a `sent` quote with `expiresAt < business today` renders as
`פג תוקף`. It is materialised into the column only when §6 needs an automation trigger.
Business-day boundaries go through [lib/time/businessDay.ts](lib/time/businessDay.ts) —
non-negotiable per architecture-rules §11 (a duplicated day boundary already caused a
production hydration crash).

### 3.4 `sales_quotes`

```sql
CREATE TABLE IF NOT EXISTS sales_quotes (
  id bigserial PRIMARY KEY,
  "agencyId" integer NOT NULL,
  "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "createdByUserId" integer NOT NULL REFERENCES users(id),
  "ownerUserId" integer REFERENCES users(id) ON DELETE SET NULL,

  -- Single-axis lifecycle. No fulfillState: a quote is not a financial record.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','sent','accepted','declined','expired')),

  -- Display identity. Allocated at ready. No legal gap-free obligation.
  "quoteNumber" bigint,
  "quoteYear" smallint,

  title text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'ILS',
  locale text NOT NULL DEFAULT 'he',

  -- Recomputed on every draft save; frozen at ready.
  "subtotalAmount" numeric(14,2) NOT NULL DEFAULT 0,
  "taxAmount"      numeric(14,2) NOT NULL DEFAULT 0,
  "discountAmount" numeric(14,2) NOT NULL DEFAULT 0,
  "totalAmount"    numeric(14,2) NOT NULL DEFAULT 0,

  -- Recipient snapshot, taken from the lead at ready. NOT a billing profile.
  "recipientNameSnapshot"  text NOT NULL DEFAULT '',
  "recipientEmailSnapshot" text NOT NULL DEFAULT '',
  "recipientPhoneSnapshot" text NOT NULL DEFAULT '',

  -- Customer-facing body.
  "introText" text NOT NULL DEFAULT '',
  "termsText" text NOT NULL DEFAULT '',
  "customerFooter" text NOT NULL DEFAULT '',
  "internalNotes" text NOT NULL DEFAULT '',   -- editable at any status

  -- Validity.
  "expiresAt" date,

  -- Lifecycle timestamps. Viewed is an event, not a state (§3.3a).
  "readyAt" timestamptz,
  "sentAt" timestamptz,
  "sentByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
  "firstViewedAt" timestamptz,
  "lastViewedAt" timestamptz,
  "viewCount" integer NOT NULL DEFAULT 0,
  "decidedAt" timestamptz,
  "declineReason" text,

  -- Conversion is a relation, not a state (§3.3b).
  "convertedInvoiceId" bigint REFERENCES bill_invoices(id) ON DELETE SET NULL,
  "convertedAt" timestamptz,

  -- Public view token. NULL until first send; rotated on re-send.
  "publicToken" text,

  "templateVersionId" smallint NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  -- Post-draft invariant. Intentionally WEAKER than the invoice's: a quote
  -- carries no issuer, no money state, no legal timestamp.
  CONSTRAINT sales_quotes_post_draft_invariants CHECK (
    status = 'draft'
    OR ("quoteNumber" IS NOT NULL AND "quoteYear" IS NOT NULL AND "readyAt" IS NOT NULL)
  ),
  CONSTRAINT sales_quotes_sent_requires_timestamp CHECK (
    status IN ('draft','ready') OR "sentAt" IS NOT NULL
  ),
  CONSTRAINT sales_quotes_converted_requires_accept CHECK (
    "convertedInvoiceId" IS NULL OR status = 'accepted'
  )
);

CREATE INDEX IF NOT EXISTS sales_quotes_agency_lead_created_idx
  ON sales_quotes ("agencyId","leadId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS sales_quotes_agency_status_expires_idx
  ON sales_quotes ("agencyId", status, "expiresAt")
  WHERE status IN ('sent','accepted');
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_agency_year_number_uniq
  ON sales_quotes ("agencyId","quoteYear","quoteNumber") WHERE status <> 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_public_token_uniq
  ON sales_quotes ("publicToken") WHERE "publicToken" IS NOT NULL;
```

**`ON DELETE CASCADE` on `leadId` is deliberate and is the opposite of the invoice's
`RESTRICT`** — and it is the clearest expression of the whole design. An issued invoice must
outlive lead deletion because it is a legal record. A quote is a sales artefact: if the lead is
gone, so is the quote. This single line is what "not a financial record" means in the schema.

### 3.5 `sales_quote_items`

```sql
CREATE TABLE IF NOT EXISTS sales_quote_items (
  id bigserial PRIMARY KEY,
  "quoteId" bigint NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
  "agencyId" integer NOT NULL,
  "lineNumber" smallint NOT NULL CHECK ("lineNumber" >= 1),

  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(10,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  "unitPrice" numeric(14,4) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),

  -- Same double-tracking as bill_invoice_lines: FK for audit, percent for display.
  "taxRateId" bigint REFERENCES bill_tax_rates(id) ON DELETE RESTRICT,
  "taxRatePercentSnapshot" numeric(7,4) NOT NULL DEFAULT 0
    CHECK ("taxRatePercentSnapshot" >= 0),

  "lineSubtotal"  numeric(14,2) NOT NULL DEFAULT 0,
  "lineTaxAmount" numeric(14,2) NOT NULL DEFAULT 0,
  "lineTotal"     numeric(14,2) NOT NULL DEFAULT 0,

  -- Optional flag: excluded from totals, shown as "אופציונלי". The only
  -- structural difference from an invoice line, and the reason items are a
  -- separate table rather than a shared one.
  "isOptional" boolean NOT NULL DEFAULT false,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_quote_items_quote_line_uniq
  ON sales_quote_items ("quoteId","lineNumber");
```

Column shape mirrors `bill_invoice_lines` exactly, which is what makes quote → invoice
conversion a field-for-field copy with no transformation (§4.4) — and what lets both tables be
edited by the same extracted `LineRow` component.

### 3.6 Additive changes to shared infrastructure

**`bill_documents`** — one relaxation, three additions:

```sql
ALTER TABLE bill_documents ALTER COLUMN "invoiceId" DROP NOT NULL;
ALTER TABLE bill_documents ADD COLUMN "quoteId" bigint REFERENCES sales_quotes(id) ON DELETE CASCADE;
ALTER TABLE bill_documents DROP CONSTRAINT IF EXISTS bill_documents_kind_check;
ALTER TABLE bill_documents ADD CONSTRAINT bill_documents_kind_check
  CHECK (kind IN ('invoice_pdf','receipt_pdf','statement_pdf','quote_pdf'));
ALTER TABLE bill_documents ADD CONSTRAINT bill_documents_one_entity CHECK (
  ("invoiceId" IS NOT NULL AND "quoteId" IS NULL) OR
  ("invoiceId" IS NULL AND "quoteId" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS bill_documents_quote_current_uniq
  ON bill_documents ("quoteId") WHERE "isCurrent" = true AND "quoteId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS bill_documents_agency_quote_created_idx
  ON bill_documents ("agencyId","quoteId","createdAt" DESC) WHERE "quoteId" IS NOT NULL;
```

`DROP NOT NULL` is the **only non-purely-additive change in the whole design.** It is
non-destructive (every existing row keeps its `invoiceId`), fully reversible, and the new
exactly-one-of CHECK is _stronger_ than the old NOT NULL for the invoice case. The alternative —
a parallel `sales_quote_documents` table — would duplicate the render lifecycle, the `isCurrent`
discipline, `markDocumentReady`/`markDocumentFailed`, the S3 poll, and the Gotenberg error
callback. That is precisely the "parallel system" the brief forbids. **Note:** `quoteId` uses
`CASCADE`, not the invoice's `RESTRICT`, for the same reason as §3.4.

**`bill_financial_events`** — the extension its own header predicted:

```sql
ALTER TABLE bill_financial_events ADD COLUMN "quoteId" bigint
  REFERENCES sales_quotes(id) ON DELETE CASCADE;
ALTER TABLE bill_financial_events DROP CONSTRAINT bill_financial_events_entity_required;
ALTER TABLE bill_financial_events ADD CONSTRAINT bill_financial_events_entity_required CHECK (
  "invoiceId" IS NOT NULL OR "leadId" IS NOT NULL OR "quoteId" IS NOT NULL
);
CREATE INDEX IF NOT EXISTS bill_financial_events_agency_quote_occurred_idx
  ON bill_financial_events ("agencyId","quoteId","occurredAt" DESC) WHERE "quoteId" IS NOT NULL;
```

**The trade-off, named:** "financial events" is now carrying sales events. The counter-argument
is that the table was built as an entity-agnostic _activity spine_ — nullable FKs, three
visibility tiers, actor kinds, an explicit forward-compat note — and the ledger of record is the
`bill_invoices` rows, not this log. The decisive argument is the **unified lead timeline**:
`quote.sent → quote.accepted → invoice.issued → payment.received` on one lead, ordered by
`occurredAt`, from one index that already exists. A separate table makes that a merge-sort
across two sources in application code, forever, and duplicates the append-only discipline.
Quote events set `quoteId` + `leadId` and leave `invoiceId` NULL, so the existing
invoice-scoped timeline is provably unaffected.

**`bill_numbering_sequences`** — widen the kind CHECK:

```sql
ALTER TABLE bill_numbering_sequences DROP CONSTRAINT bill_numbering_sequences_kind_check;
ALTER TABLE bill_numbering_sequences ADD CONSTRAINT bill_numbering_sequences_kind_check
  CHECK (kind IN ('invoice','receipt','quote'));
```

The table is a generic per-`(agency, year, kind)` counter with no FK to anything; only its
`bill_` prefix suggests otherwise. Reusing `allocateNumberInTransaction` avoids a second
allocator for zero benefit. **Document in the migration header** that quote numbering carries no
gap-free legal obligation, so a future reader does not infer one from the neighbours.
_Alternative if that ambiguity is unacceptable:_ a `sales_quote_sequences` table with the same
shape — ~30 lines of duplicated allocator. Not recommended.

**`lib/billing/events/visibility.ts`** — add `'quote.'` to `USER_VISIBLE_PREFIXES`. Without it
every quote event defaults to `'system'` and the timeline renders empty.

### 3.7 Event vocabulary

```ts
export const QUOTE_EVENTS = {
  DRAFTED: 'quote.drafted',
  UPDATED: 'quote.updated',
  READY: 'quote.ready',
  SENT: 'quote.sent',
  VIEWED: 'quote.viewed',
  ACCEPTED: 'quote.accepted',
  DECLINED: 'quote.declined',
  EXPIRED: 'quote.expired',
  CONVERTED: 'quote.converted',
} as const
```

`quote.converted` carries `{ quoteId, invoiceId }` and is appended **twice** — once with
`quoteId` set and once with `invoiceId` set — so both timelines show the join without either
having to query the other.

---

## 4. API design

Server Actions in `actions/quotes/`, mirroring `actions/billing/` conventions exactly: typed
discriminated results, `requireProductAccess()`, `getPerms` lead gate (via the new
`assertLeadAccess` from §2.5), `revalidatePath`, structured logs.

### 4.1 Actions

| Action                                                  | File                | Guard                 | Result reasons                                                                |
| ------------------------------------------------------- | ------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `createQuoteDraftAction({leadId, title?})`              | `drafts.ts`         | `canDraftQuote`       | `no_permission · lead_not_found · failed`                                     |
| `updateQuoteDraftAction({quoteId, meta})`               | `drafts.ts`         | draft only            | `not_draft · quote_not_found · failed`                                        |
| `saveQuoteItemsAction({quoteId, items})`                | `drafts.ts`         | draft only            | `not_draft · invalid_line · failed`                                           |
| `deleteQuoteDraftAction({quoteId})`                     | `drafts.ts`         | draft only            | `not_draft · failed`                                                          |
| `markQuoteReadyAction({quoteId})`                       | `ready.ts`          | `canSendQuote`        | `not_draft · no_lines · no_recipient · failed`                                |
| `getQuotePdfStatusAction(quoteId)`                      | `documentStatus.ts` | read                  | — (snapshot)                                                                  |
| `sendQuoteAction({quoteId, email, message?})`           | `send.ts`           | `canSendQuote`        | `not_ready · pdf_not_ready · invalid_email · rate_limited · transport_failed` |
| `recordQuoteOutcomeAction({quoteId, outcome, reason?})` | `outcome.ts`        | `canSendQuote`        | `not_sent · already_decided · failed`                                         |
| `convertQuoteToInvoiceAction({quoteId})`                | `convert.ts`        | **`canIssueBilling`** | `not_accepted · already_converted · no_billing_profile · no_permission`       |

`markQuoteReadyAction` is the transactional analogue of `issueInvoice`: `FOR UPDATE` → validate →
resolve effective tax rate → `computeInvoiceLegalTotals` → allocate number → freeze totals +
recipient snapshot → append `quote.ready` → `scheduleQuotePdfRender`. Note it is **not** in
`db/` under a `use server` file — same split as billing (`db/billing/issueInvoice.ts` holds the
transaction, `actions/billing/issue.ts` holds the guard).

### 4.2 Route handlers

| Route                                       | Purpose                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/quotes/[quoteId]/download`        | Authenticated presigned GET + `Content-Disposition`, 302. Clone of the invoice download route.                               |
| `GET /q/[token]`                            | **Public, unauthenticated.** Renders a minimal branded page + the quote PDF; appends `quote.viewed`. Phase 5 only. See §8.4. |
| _(reused)_ `POST /api/billing/render-error` | Already entity-agnostic — keys on `documentId`+`agencyId`. **No change.**                                                    |

### 4.3 Permissions

New predicates in `lib/quotes/permissions.ts`, composed from the same role primitives — no new
auth model:

```ts
canReadQuotes(user)  → true                    // narrowed by lead perms at the data layer
canDraftQuote(user)  → user.role !== Roles.EXT // mirrors canDraftBilling
canSendQuote(user)   → user.role !== Roles.EXT // a rep sends quotes; managers issue invoices
canConvertToInvoice  → canIssueBilling(user)   // reused verbatim — conversion IS issuance
```

**The deliberate asymmetry — `canSendQuote` ⊃ `canIssueBilling` — is the product point.** A
נציג can quote (sales) but not invoice (accounting). This is the permission model _stating_ the
boundary the brief asked for.

### 4.4 Conversion contract

`convertQuoteToInvoiceAction` creates a **new draft invoice** and never touches invoice issuance
logic:

1. Assert `status = 'accepted'`, `convertedInvoiceId IS NULL`, `canIssueBilling`.
2. Require an active `bill_billing_profiles` row; if absent, return `no_billing_profile` and let
   the UI open the existing `IssuerIdentityModal` / profile flow. **Never auto-create a legal
   billing identity.**
3. In one transaction: `createDraftInvoice` + copy non-optional items field-for-field into
   `bill_invoice_lines` (identical column shape — no transformation), set
   `sales_quotes.convertedInvoiceId` / `convertedAt`, append `quote.converted` twice (§3.7).
4. Redirect to the existing `/clients/{leadId}/billing/{invoiceId}` draft editor.

The user then issues through the **unmodified** existing flow. Tax rates are re-resolved at
issue time by `issueInvoice`, exactly as for any other draft — a quote from three months ago
cannot smuggle a stale VAT rate into a new invoice. **Zero lines of invoice issuance code change.**

---

## 5. UI/UX flow

### 5.1 Where quotes live — one tab, not two

**Recommended: rename the lead tab `חיוב` → `מסמכים`** and list quotes and invoices there,
newest first, with a kind chip. Then flip `DOCUMENT_KINDS.quote.enabled = true` and set
`routeKind: 'quote'` — the picker (`צור מסמך` → _"איזה מסמך להפיק?"_) already renders the row as
a muted `בקרוב` item and routes on `routeKind`. That registry was built for exactly this moment.

Why not a fifth tab: `ClientNav` would go to five items; a rep chasing one lead would have to
know whether the thing they sent lives under "quotes" or "billing"; and quote → invoice is a
_journey_, so splitting it across tabs breaks the story. One list where a quote row visibly
becomes an invoice row is the 5-second answer to _"where are we with this lead?"_.

_Alternative if quote volume dominates in practice:_ a fifth tab. Reversible either way — the
data model does not depend on this choice.

### 5.2 Screens

```
/clients/[clientId]/documents            list: quotes + invoices, kind chip, status chip
/clients/[clientId]/quotes/new           editor (full page, InvoiceNewEditor shape)
/clients/[clientId]/quotes/[quoteId]     draft → editor · non-draft → frozen view + PDF + timeline
/q/[token]                               public customer view (Phase 5)
```

No new layout, no new component family: the editor reuses the invoice editor's skeleton
(`InvoicePageHeader` → `RecipientCard` → `InvoiceLinesEditor` → `InvoiceTotalsSummary` →
`InvoiceActionBar`), the frozen view reuses `InvoiceFrozenView`'s shape (`InvoicePdfLive` +
`InvoiceTimelineList`), and `SendInvoiceModal` is generalised rather than cloned.

### 5.3 The one-action flow

Per CLAUDE.md §10 and ux-guidelines §7, quoting must be one screen and one primary action.

```
צור מסמך → הצעת מחיר → [editor] → שלח הצעה
                                      ├─ freeze + allocate number + dispatch PDF   (ready)
                                      ├─ poll until PDF ready (existing poller, skeleton)
                                      └─ SendQuoteModal → email → toast "ההצעה נשלחה ל־<שם>"
```

`סמן כמוכנה` is the secondary action for prepare-now-send-later. One primary button per screen
(ux-guidelines §5); every label names its object (§3).

### 5.4 Status presentation

Chips follow `components/billing/chips.tsx` exactly — same sizes, same border/bg/text triples:

| Status           | Label        | Tone                                                 |
| ---------------- | ------------ | ---------------------------------------------------- |
| `draft`          | טיוטה        | gray                                                 |
| `ready`          | מוכנה לשליחה | blue                                                 |
| `sent`           | נשלחה        | blue (+ secondary `נצפתה` when `firstViewedAt`)      |
| `sent` + expired | פג תוקף      | amber                                                |
| `accepted`       | התקבלה       | green (+ `הומרה לחשבונית` when `convertedInvoiceId`) |
| `declined`       | נדחתה        | red                                                  |

Never colour alone (a11y, ux-guidelines §9) — every chip carries text.

### 5.5 Empty state

Per ux-guidelines §4 — what happened, why it matters, what next. Reuses the exact
`LeadBillingList` `EmptyState` block:

> **אין מסמכים לליד זה** — שליחת הצעת מחיר היא הצעד שמקדם ליד לסגירה.
> [ **צור מסמך** ]

Filtered-empty and system-empty stay distinct (§ux-guidelines 11).

### 5.6 Interaction rules that bind this feature

From [frontend-experience-guidelines.md](claude/frontend-experience-guidelines.md):
outcome buttons (accept/decline) are **optimistic with rollback** (§6); pending state is local to
the clicked control (§7); PDF wait shows a content-shaped skeleton, never a full-screen spinner
(§3); the `sent` toast is a real outcome, not a loading system (§16); the poller stops on
terminal state and backs off on hidden tabs (§14); `הצעה נדחתה` requires a `ConfirmPop` naming
the quote (§17).

---

## 6. Automation events

The engine is fully catalog-driven — [AutomationSheet](components/settings/automations/AutomationSheet.tsx)
"names no integration, no status and no trigger." Adding quotes is mostly **data**.

### 6.1 Catalog additions (data only)

```ts
// lib/automations/catalog/entries/subjects.ts — one line, the fourth subject
{ key: 'quote', title: 'הצעות מחיר', icon: 'file-invoice' }
```

Events, with fields the worker can actually resolve at send time:

| Event            | Origin         | Anchor field           | Use case                                           |
| ---------------- | -------------- | ---------------------- | -------------------------------------------------- |
| `quote_sent`     | `manual`       | `sentAt` (datetime)    | _"3 days after sending, if no answer — follow up"_ |
| `quote_accepted` | `manual`       | `decidedAt`            | _"send a thank-you + next steps"_                  |
| `quote_declined` | `manual`       | `decidedAt`            | _"win-back after 30 days"_                         |
| `quote_expiring` | `scheduled` ⚠️ | `expiresAt` (datetime) | **BEFORE-ANCHOR: "2 days before expiry, remind"**  |

Fields: the standard `LEAD_FIELDS` set plus `quoteNumber` (text, snapshot), `quoteTotal`
(text, snapshot — pre-formatted server-side, like `meetingWhen`), `quoteExpiresAt` (datetime,
snapshot), `quoteStatus` (enum, **live** — a declined quote must not produce a reminder, the
same invariant as `meetingStatus`).

`quoteExpiresAt` as a `datetime` field is what unlocks BEFORE-ANCHOR timing with **zero engine
changes** — the arithmetic already exists in `resolveSendAtDetailed`.

### 6.2 Emission

`emitAutomationEvent` calls in `markQuoteReadyAction` / `sendQuoteAction` / `recordQuoteOutcomeAction`.
`occurrenceKey` per ADR-010: `quote_sent:{quoteId}:{sentAt.getTime()}` — deterministic from
business facts, never random.

### 6.3 Two real blockers

1. **`quote_expiring` has no honest origin.** `TRIGGER_ORIGINS` has no scheduled value. Appending
   `'scheduled'` is legal (append-only vocabulary) but is a genuine vocabulary change plus a new
   cron evaluator (§2.4). **Defer to a later phase** — the three `manual`-origin events deliver
   most of the value with no new machinery.
2. **The engine ships OFF.** `AUTOMATIONS_ENABLED !== '1'` ⇒ off; allowlist empty ⇒ no agency;
   `AUTOMATIONS_SEND_MODE` defaults to `log`. Per the Feature Rollout Standard, quote automations
   must not be merged as UI that silently does nothing — either document the env vars in the same
   PR or keep the catalog entries out until the engine is live.

### 6.4 Invariant to add

Mirror `lib/automations/appointments.ts`: a quote reminder must not fire when the quote was
already accepted/declined, was deleted, or already expired. New skip reasons
(`quote_missing`, `quote_decided`, `quote_expired`) — **appended, never reused**, since
`SKIP_REASONS` is persisted data.

---

## 7. AI opportunities

Ranked by value ÷ effort. Every one is checked against the [care-charter](claude/care-charter.md)
evaluation test (§11) before it appears here.

### 7.1 Wire the `send_quote` suggestion — near-zero AI work, highest value

The AI **already** classifies conversations and emits `suggestedAction: 'send_quote'`, already
ranks it #6 in inbox ordering, already labels it `שלח הצעת מחיר`. **There is nothing to click.**
Making that label a link to `/clients/{leadId}/quotes/new` closes a loop that is already 95%
built.

_Charter check:_ burden = **Reactive → Ahead**. Truth = the suggestion is already produced from
real conversation data. Agency = the rep still writes and sends. Law 7 (every claim actionable)
is currently _violated_ by the status quo — this fixes it. **Ships as part of Phase 6.**

### 7.2 Quote-aware Today / briefing signal

`db/briefing.ts` already produces deterministic "needs you today" states. Add two:

- **sent, not viewed, ≥3 days** → _"ההצעה לדוד נשלחה לפני 4 ימים — כדאי לוודא שהגיעה"_
- **accepted, not converted** → _"ההצעה של רונית התקבלה — אפשר להוציא חשבונית"_

Both are pure SQL over `sales_quotes`. Per the Business State Engine boundary, a _state_ must be
true with no LLM — these are. The language layer may rephrase; it never produces the count.

_Charter check:_ burden = **Out of control → Held**; Law 18 (the unsolicited save). No shaming
framing (Law 13): _"כדאי לחזור ל…"_, never _"הזנחת…"_.

### 7.3 Line-title drafting from the conversation — with a hard price rule

Given an inbox thread, propose _item titles and descriptions_ pre-filled into a draft. **Never
amounts.** There is no product catalog (§2.6), so any price the model produced would be invented
— Law 1, the one violation that ends the relationship. Amount fields stay empty and required.

Note `lib/inbox/autoresponse/validate.ts` already blocks the auto-responder from uttering
prices; this feature must not become the loophole that walks that back.

### 7.4 Copilot lead context

Add open/accepted quotes to `buildCopilotLeadContext` so _"where are we with this lead?"_ can
answer _"הצעה #00042 נשלחה ב־3.8, טרם התקבלה תשובה"_. Data addition to an existing assembler.

### 7.5 Explicitly rejected

| Idea                                                   | Why it fails                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| AI auto-sends a quote when it detects a pricing intent | Law 15 + charter §12 "AI must not auto-send customer messages". A wrong price sent automatically is unrecoverable. |
| AI sets quote prices from "similar past quotes"        | Law 1 — a price derived by a model is a fabricated business fact, however plausible.                               |
| "Your quote is expiring!" urgency push                 | Law 16 (urgency must be real, rare, earned) + Law 23 (never monetise a care moment).                               |
| A quote-conversion-rate dashboard                      | CLAUDE.md §11 — data that does not help the user act.                                                              |

---

## 8. Risks

| #    | Risk                                                                                                                                                                                       | Severity | Mitigation                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | **Scope creep into CPQ.** Quotes attract catalogs, discount tiers, approval chains, e-signature, multi-currency, templates.                                                                | **High** | Explicit v1 exclusions: no catalog, no percent discounts, no approval chain, no e-signature, no multi-currency, no versions table. Written into the phase gates below.                                                                                                    |
| 8.2  | **Generalising the PDF pipeline regresses the money path.** Invoices are live and legally binding.                                                                                         | **High** | Phase 0 does the seam extraction with **zero behaviour change**, verified by the existing `render-invoice-pdf.test.ts` + `html-rendering.stress.test.ts` before any quote code exists. Quote rendering lands in a later phase.                                            |
| 8.3  | **`bill_documents` NOT NULL relaxation** is the one non-additive migration.                                                                                                                | Medium   | Non-destructive, reversible; the replacement exactly-one-of CHECK is strictly stronger for invoices. Verify with a `COUNT(*) WHERE invoiceId IS NULL` = 0 assertion post-migration.                                                                                       |
| 8.4  | **Public `/q/[token]` route** — first unauthenticated customer surface. Token leak exposes prices; **mail scanners prefetch links and manufacture fake "views"**; forwarding is untracked. | **High** | Deferred to Phase 5 and shippable-without. 32-byte random token, unique index, rotated on re-send, invalidated on decline/expiry. Ignore views within 10s of send. Never feed `viewCount` into urgency or AI claims (Law 1/16). No PII beyond what is already on the PDF. |
| 8.5  | **Semantic drift** — sales events in a table named `bill_financial_events`.                                                                                                                | Medium   | Accepted deliberately (§3.6) for the unified lead timeline. Migration header states the boundary: the ledger is `bill_invoices`; this table is the activity spine.                                                                                                        |
| 8.6  | **Two document lists confuse the 5-second rule.**                                                                                                                                          | Medium   | One `מסמכים` tab, one list, kind chips (§5.1). Validate with the first pilot agency before adding surfaces.                                                                                                                                                               |
| 8.7  | **Automation engine is OFF in production.** Quote automations would ship inert.                                                                                                            | Medium   | Phase 6 gate: either the env vars are documented and set in the same PR, or the catalog entries do not merge (Feature Rollout Standard).                                                                                                                                  |
| 8.8  | **DB integration tests cannot run** (repo-wide harness blocker).                                                                                                                           | Medium   | Test the pure layer (totals, status transitions, conversion mapping, event-payload factories) as unit tests; assert data-layer queries at SQL level via `.toSQL()`. Do not weaken the design to fit the harness.                                                          |
| 8.9  | **Copying the invoice editors breaches architecture-rules on day one** (368/322-line files).                                                                                               | Medium   | Phase 0 lifts `lines/` into `components/documents/lines/`. No quote file may exceed 250 lines without a header exception.                                                                                                                                                 |
| 8.10 | **A quote number leaking into invoice numbering** would corrupt legal sequences.                                                                                                           | **High** | `kind='quote'` is a distinct composite-PK row; `sales_quotes` has its own unique index; conversion **copies items only, never the number**. Add a test asserting `bill_invoices.documentNumber` is never sourced from `sales_quotes`.                                     |
| 8.11 | **Terminology drift** — quotes invite `לקוח`/`עסקה`.                                                                                                                                       | Low      | `ליד`/`נציג`/`הצעת מחיר` only. Closed leads remain leads by status (CLAUDE.md Entity Constraint).                                                                                                                                                                         |
| 8.12 | **`ON DELETE CASCADE` on `leadId` is irreversible data loss** if someone later decides quotes need retention.                                                                              | Low      | Deliberate and documented (§3.4). Lead deletion is already gated; if retention is ever required it becomes a soft-delete change, not an FK change.                                                                                                                        |

---

## 9. Phased implementation roadmap

Each phase is independently shippable and independently revertible. Everything from Phase 1 on
sits behind `QUOTES_ENABLED=1` + `QUOTES_AGENCY_ALLOWLIST`, mirroring the `AUTOMATIONS_*` pattern
(absence blocks).

### Phase 0 — Seams (no user-visible change, no quote code)

- Extract `assertLeadAccess(user, leadId)` into `lib/access/`; **quote surfaces are its only
  callers** (do not retrofit invoice call sites here).
- Lift `components/billing/lines/` → `components/documents/lines/`; billing imports the new path.
- Introduce `RenderableDocument` + an invoice adapter; `dispatchRender` takes a source.
- **Gate:** `npx tsc --noEmit` clean; `test:a11y` green; billing PDF tests green; a rendered
  invoice PDF is byte-identical (compare `contentHash`) before/after.

### Phase 1 — Data model + draft CRUD

- Migrations: `sales_quotes`, `sales_quote_items`, + the three shared-table extensions (§3.6).
- `db/quotes/*`, `lib/quotes/{permissions,status,numbering}.ts`, `actions/quotes/drafts.ts`.
- Documents tab renamed; unified list; `DOCUMENT_KINDS.quote.enabled = true`.
- Quote editor (create/edit/delete draft, live totals via `lib/billing/totals.ts`). No PDF, no send.
- **Excluded:** catalog, percent discounts, approvals, versions.
- **Gate:** a rep can build a quote and see correct totals; no invoice behaviour changed.

### Phase 2 — Ready + PDF + timeline

- `markQuoteReadyAction` (freeze, allocate, snapshot recipient), `scheduleQuotePdfRender`.
- `QuoteTemplate` composed from the existing PDF components + a validity/terms block.
- `getQuotePdfStatusAction` (reuses the HeadObject poller), authenticated download route.
- `quote.drafted/updated/ready` events; quote timeline (reuse `InvoiceTimelineList`'s shape).
- **Gate:** a quote PDF renders and downloads; `bill_documents` invoice rows unaffected.

### Phase 3 — Send

- `QuoteSentEmail` (clone of `InvoiceSentEmail`), `sendQuoteAction` with the 30s
  event-lookback cooldown, generalised `SendQuoteModal`, `quote.sent`.
- **Gate:** the one-action flow (§5.3) works end to end; failures roll back visibly.

### Phase 4 — Outcome + conversion

- `recordQuoteOutcomeAction` (optimistic, rollback on failure).
- Derived `expired` via `lib/time/businessDay.ts` — **no cron**.
- `convertQuoteToInvoiceAction` → new draft invoice, `convertedInvoiceId`, dual `quote.converted`.
- **Gate:** conversion produces a normal draft invoice issued through the **unmodified** flow;
  test asserts quote numbers never enter invoice sequences (§8.10).

### Phase 5 — Public view (optional; ship only if asked for)

- `publicToken`, `/q/[token]`, `quote.viewed`, `firstViewedAt`/`viewCount`, `נצפתה` badge.
- **Gate:** the §8.4 mitigations are all implemented, including scanner-view suppression.
  If they are not, do not ship this phase — every other phase already works without it.

### Phase 6 — Intelligence

- Catalog: `quote` subject + the three `manual`-origin events (only if the engine is live).
- Briefing signals (§7.2); `send_quote` → new-quote link (§7.1); Copilot context (§7.4).
- **Gate:** every signal is deterministic SQL; no model produces a number.

### Deferred indefinitely (revisit only on evidence of real friction)

Item catalog · customer self-accept · `scheduled` trigger origin + expiry cron · WhatsApp
quote delivery · quote templates · versions/revision history · e-signature · analytics dashboard.

---

## Appendix — the audit's one-line summary

The infrastructure this feature needs is already built and was, in three places, explicitly
designed to be extended: a disabled `quote` entry in the document-kind registry, a
`suggestedAction: 'send_quote'` with no destination, and an event-spine migration whose own
header says future entities get additive nullable FK columns. The work is **two new tables, three
additive extensions to shared tables, one NOT NULL relaxation, and one render seam** — not a
second document system.
