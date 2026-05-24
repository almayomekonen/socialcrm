# Features

Only features that exist in the codebase today. No stubs, no roadmap.

---

## Lead management

- **One entity, one list.** Every prospect lives as a `Lead`. Closed leads become clients — same record, status change. No separate "Clients" page.
- **Status workflow** with SLA hours: new → contacted → interested → closed / lost. Status timestamp tracked separately for stagnation detection.
- **Handler vs owner separation.** A lead can be owned by one person and worked by another.
- **Family grouping.** Leads can be linked as a family (`familyId`) to see the whole household at once.
- **Lead source tracking** with unique-source enforcement to prevent duplicates.
- **Excel import.** Upload a spreadsheet, leads appear in the table.
- **Excel + PDF export.** Any filtered view exports to either format, with RTL Hebrew support and chunking for large tables.

## AI Copilot

- **Lead Intelligence Card** — server-rendered, cached 24h. Shows a 1–2 sentence summary, two key insights, the suggested next action, and a confidence badge on every lead page.
- **Conversational Copilot panel** with streaming responses, opened from the topbar on any lead.
- **Three modes** — Fast, Smart, Advanced — mapped to different model tiers under the hood.
- **Four AI actions** wired today:
  - Summary (lead intelligence)
  - Draft follow-up message
  - Suggest next step
  - Ask a free-form question about the lead
- **Multi-provider** — Anthropic, Google, and OpenAI, with automatic fallback. The user never sees model names.
- **Intent classification.** Social messages (thanks, hello) get fast shortcuts; CRM questions go to the full LLM.
- **Run-level telemetry.** Every AI generation records provider, model, tokens, cost, latency, and success in `ai_runs`. Used by the admin AI Inspector.

## Google Drive integration

- **OAuth-based connection** per user, with AES-256-GCM encrypted token storage.
- **Suggested files.** The system seeds a Drive search using the lead's name, email, and phone, and surfaces matching files automatically.
- **Freetext Drive search** for any lead, with auto-escape.
- **One-click attach.** Selected files are stored as references in `lead_drive_files` — original Drive permissions remain untouched.
- **Live links.** Attached files open directly in Drive; nothing is mirrored or duplicated.

## Local file storage

- Direct upload to S3, up to 10 MB per file.
- Supports PDF, images, XLSX, documents.
- Files can be attached to a lead, a task, or a sales record.

## Sales / deals pipeline

- **Deals as a separate entity** linked to leads, with status workflow (new, estimate, proposal, in-negotiation, pending-payment, paid, cancelled).
- **Multi-rep splits.** A single deal can be assigned to multiple reps with percentage shares (`sale_users.prcnt`) for commission accuracy.
- **Branch taxonomy.** Deals categorized into Services, Products, Courses, Subscriptions, Packages, Consulting, Other.
- **Reassign on agent departure.** `transferSales` reassigns all of an agent's deals — handler, creator, and collaborators — to a replacement in one action.
- **Sales dashboard** with monthly revenue by branch, total deals, pipeline value, and goals vs. actuals (yearly and monthly, per user, per branch).
- **Three-level breakdown** (`sum_pie`) — branch → product type → product — for performance analysis.

## Tasks

- **Per-lead tasks** with due dates, sub-tasks, file attachments, and timestamped notes.
- **Reusable task templates** so common workflows (e.g. "new lead intake checklist") are one click.

## Internal competitions ("Promotions")

- **Sales competitions** with start/end dates, goals (JSON), and assigned participants.
- **Two scopes:** individual agents or manager-only group competitions.
- Totals calculated automatically from the deals table.

## Multi-tenancy & roles

- **Agency → Teams → Users** structure. Every record is agency-scoped.
- **Six roles:** Admin, Manager, Agent, Office, GM, External.
- **Permission graph** (`user_perms`) — managers can grant visibility over specific leads to specific agents.
- **Invitations** with 7-day token expiry, role assigned before the invitee joins.

## Authentication

- **Google Sign-In** (OAuth, JWT decoded into session).
- **Magic link** via 15-minute email token.
- **Passkeys** (WebAuthn) via `@simplewebauthn`.
- **365-day session** stored in JWT-HS256 cookies, refreshed every 2 days.

## Plans & billing

- **Free tier:** up to 50 leads per agency.
- **Pro tier:** unlimited leads plus the full AI Copilot layer.
- Upgrade flows through the existing Grow payment integration; on success the agency plan flips to `pro`.
- **Full invoicing system** in the DB: invoices, invoice lines, financial events, billing profiles, tax rates, document snapshots with issuer identity for audit.
- Welcome email and invoice email templates (Resend).

## Settings

- User profile, security, payment, default preferences.
- Admin-only: team management, user management, promotion management, task template management, AI Inspector (behind feature flag).

## Internationalization

- **Hebrew-first.** All UI, all copy, RTL throughout the application.
- Assistant font (Google Fonts) for consistent Hebrew rendering.
