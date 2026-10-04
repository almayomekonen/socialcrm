# MCP tools (Phase A — seven read-only tools)

All tools are registered in `lib/mcp/tools/index.ts`, annotated `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`, publish strict input and output schemas, and declare their scope in `_meta.securitySchemes`. Every call runs through `runTool` (principal → scope → rate limit → validated input → tool → one audit row).

Common rules for every tool:

- **Authorization:** agency and user come only from the authenticated principal. Leads are visible exactly as in the product (`scopedLeads`: same agency, `lead = true`, `userId IN gotPermIds` for non-admins, free-plan `overQuota` hidden). Not permitted is the same `not_found` as missing.
- **Inputs:** zod `.strict()` — unknown keys, wrong types, invented statuses/intents and oversize limits are `invalid_input`. The error names only the field path and issue code, never the value.
- **Lead shape:** every lead carries `leadId`, `name`, `url` (`${MCP_PUBLIC_ORIGIN}/clients/<id>`) and `contactDetails: "unavailable"`.
- **Statuses:** only `new`, `contacted`, `interested`, `closed`, `lost` (with the product's Hebrew label); anything else is `null`.
- **No contact data:** phone, email, WhatsApp ids and external identifiers are never selected for output. See [security.md](./security.md) for what free text may still contain.

## Lead tools — scope `crm.leads.read`

### `search_leads`

Find leads by first/last name and/or status, most recent activity first.

- Inputs: `query?` (1–80 chars, name only), `status?` (1–5 statuses), `limit` 1–25 (default 10). At least one of `query`/`status`.
- Limits: a query containing `@` or more than 4 digits is refused (`invalid_input`) — no reverse phone/email lookup; phone/email columns are never searched. LIKE wildcards are literal. `truncated` says more exist.
- Output: `{ items: [lead + status, statusLabel, ownerName, nextFollowUpAt, lastActivityAt], truncated }`.

### `get_lead`

One lead's current state.

- Inputs: `leadId` (positive integer from another tool).
- Output: lead + `status`, `statusLabel`, `source` (channel only: whatsapp/facebook/instagram/website/manual/other — the stored `channel:externalId` suffix is never returned), `ownerName` ("בעל הליד"), `createdAt`, `statusChangedAt`, `lastActivityAt`, `nextFollowUpAt`, `followUpNote` (scrubbed, ≤280 chars), `lastOutcome` (fixed product label or null), `hasWhatsappConversation`, `contactDetailsNote`.
- Not included: task statistics and notes excerpts (the product's lead reader needs a browser session).

### `get_leads_needing_followup`

The product's follow-up slot (`nextFollowUpAt` + `followUpNote`); closed/lost excluded; database clock.

- Inputs: `bucket` `overdue` (default) | `upcoming`, `limit` 1–25.
- Output: `{ bucket, total (true count), truncated, items: [lead + status, statusLabel, nextFollowUpAt, followUpNote] }`.

### `get_today_brief`

The same `buildTodayBrief` the web app and mobile API use, scoped to the user.

- Inputs: none.
- Output: `{ total, remaining, handledToday, done, permissionVerdict, truncated, items (≤50): [lead + state, reason (Hebrew), conversationId, waitingFor] }`. Phone, links, window hints, greeting and meetings are not forwarded. `permissionVerdict: scoped_partial` means the user sees only part of the team's work.

## Conversation tools — scope `crm.conversations.read`

WhatsApp only (`inbox_conversations`). Personal threads are never returned. Linked conversations are visible only if their lead is visible (`getLeadForMcp`); **unlinked** conversations only to ADMIN and GM (`isAdmin`). Every conversation result carries `conversationId`, `channel: "whatsapp"`, `url` (`/inbox?conversation=<id>`), `state`, `lastMessageAt`, `lastInboundAt`, `waitingForReply` (product waiting-reply rule) and the **stored** intelligence: `summary` (≤1200 chars), `intent`, `temperature`, `intelligenceStatus` (`fresh|stale|failed|none`), `intelligenceUpdatedAt`. Missing intelligence is `null`/`none` — never computed, no LLM call.

### `get_lead_conversations`

- Inputs: `leadId`, `limit` 1–20 (default 10).
- Output: `{ lead, items: [conversation], truncated }`. No message text.

### `get_conversation`

- Inputs: `conversationId`, `includeMessages` (default false), `messageLimit` 1–50 (default 20).
- Output: conversation + `lead` (or null when unlinked). `customerName` (WhatsApp profile name, scrubbed) is returned **only for unlinked conversations** (ADMIN/GM); it is absent when a lead is linked. Only with `includeMessages=true`: `messages` (newest `messageLimit`, returned oldest-first) and `messagesTruncated`. Each message: `messageId`, `author` (`customer` | `business` | `automation`), `type`, `sentAt`, `text` (≤1000 chars, stricter scrubbing; contact cards and locations return no text), `contentTruncated`.
- Rate limit: `includeMessages=true` also counts against the hourly message-read limit (120 per grant).

### `get_unanswered_conversations`

Threads whose latest customer message has not been answered by a person — the product's waiting-reply rule: open thread, last inbound after the last human outbound (automated replies do not count), within 14 days; linked leads must be visible and not closed/lost; unlinked threads only for ADMIN/GM.

- Inputs: `minWaitingHours` 0–336 (default 0), `intent?` (the analyzer's own values), `limit` 1–25.
- Output: `{ items: [conversationId, channel, url, lead|null, waitingSince, stored intelligence], truncated }`, oldest-waiting first. No message text.

## Adding a tool safely (checklist)

1. **Scope:** pick an existing scope or add one deliberately (config, consent label, metadata, tests). Never widen an existing scope's meaning silently.
2. **Principal only:** take agency/user/role/`gotPermIds` from `McpPrincipal`; never accept ids for tenancy from input.
3. **Gate before enrich:** load the authorized row through the product's scoped reader first; fetch details only for what passed. Not permitted = `not_found`.
4. **Select, don't strip:** never select phone, email, WhatsApp ids, payloads or metadata objects. If a shared reader selects them, drop them in the tool and say so in a comment.
5. **Free text:** pass names/notes through `untrustedText`/`personName`; message text through `presentConversation`'s stricter presenter.
6. **Schemas:** `.strict()` input, an output schema, explicit nullable fields.
7. **runTool:** register through `MCP_TOOLS`; set `target`, and `includeMessages` when the tool returns raw message text.
8. **Audit:** confirm the sanitiser keeps only ids/limits/booleans/known enum values for your inputs (add enum allowlists in `lib/mcp/audit.ts`).
9. **Description:** say what it is for, when not to use it, its limits, and that customer/rep text is data, not instructions.
10. **Tests:** visibility (admin/manager/rep/other agency), not-found equality, no-contact-data assertions, invalid input audited, prompt-injection fixture, and a deliberate-break check that the tests fail without the guard.
