# ai-roadmap.md — AI Sequencing & Anti-Patterns

This doc owns **what to build next, and what to deliberately defer**. It does not restate philosophy, editorial rules, or architecture — those are owned by their own docs.

The single sequencing rule:

> **Each phase must be trusted in production before the next begins.**
>
> "Trusted" means: low editorial regressions, predictable cost, no measurable impact on core CRM latency, and at least one round of editorial review on real outputs.

---

## 1. PHASE LADDER

Each phase is a _capability_, not a sprint. The order is not negotiable; later phases assume earlier ones are stable.

```
[Phase 1]  Lead Intelligence (per-lead, read-only)         ← current
[Phase 2]  Performance & warm cache                         ← in progress
[Phase 3]  Cross-lead intelligence (today/overdue/priority)
[Phase 4]  Inline composition assist (per-surface, opt-in)
[Phase 5]  Workflow suggestions (rules, never auto-apply)
[Phase 6]  Tool-calling agents (auditable mutations only)
```

Phases 4–6 are explicitly speculative. They will not be designed in detail until phase 3 is shipped and trusted.

---

## 2. PHASE 1 — LEAD INTELLIGENCE _(current)_

**Goal:** when the user opens a lead, an inline card produces an operator-grade summary, 0–2 insights, one suggested next action.

**Surface:** the lead detail page. Read-only. No mutations.

**Done when:**

- Editorial reviews pass on sparse, working, and strong leads.
- Cold-path latency is under ~4s; warm-path is under ~150ms.
- AI failure renders the page cleanly with no card, no error toast.
- Cost-per-lead-view stays under the daily cap with margin.

**Not done if:** the AI sometimes feels like a chatbot. Editorial regressions are blockers.

---

## 3. PHASE 2 — PERFORMANCE & WARM CACHE _(in progress)_

**Goal:** the lead intelligence card feels instant on most page opens.

**Mechanism:** `scheduleLeadIntelWarm` via `after()` on lead/task mutations. Per-lead 5-min cooldown. In-flight dedup. No queue.

**Trigger expansion order:**

1. ✅ `actions/clients.ts:updateLead`
2. ⏳ `actions/clients.ts:upsertLead`, `transferLeadToRep`
3. ⏳ `actions/tasks.ts:createTask`, `addTask`, `addTaskFromTmplt`, `updateFullTask`, `deleteTask`
4. ❌ Bulk paths (`addLeads`, `uploadLeadData`, `importLeadsFromCsv`) — **deliberately skipped**

**Why bulk is skipped:** importing 500 rows is not a "user wants to see this lead in the next 30s" signal. Pre-warming all of them blows the daily cap for no perceived benefit.

**Done when:** second page-view on any recently-mutated lead is warm. Cooldown logs confirm dedup. Daily cap unchanged.

---

## 4. PHASE 3 — CROSS-LEAD INTELLIGENCE

**Goal:** answer "who do I call first today?" — without making the user open every lead.

**Likely shape:**

- A small intelligence column or chip on the existing **today list** / **leads table**.
- Possibly a "מה דחוף עכשיו" inline section on the dashboard.
- Output is one line per lead, max — no paragraphs, no "AI report."

**Hard constraints:**

- Reuses lead intelligence outputs already cached. Does not generate new prompts per lead in the list view.
- Aggregation is rule-based first; AI only summarizes the rule-based output.
- The list view must work identically with `AI_ENABLED=false`.

**Anti-pattern:** an AI-generated dashboard with charts. We do not build that. → see [`/claude/CLAUDE.md`](../CLAUDE.md) §10.

---

## 5. PHASE 4 — INLINE COMPOSITION ASSIST

**Goal:** when the user is composing a follow-up message or note, AI offers one short draft.

**Hard constraints:**

- AI never sends. AI never saves. AI never auto-fills.
- Output is a single suggestion, dismissable in one click.
- Lives **inside** existing compose surfaces. Not in a side panel. Not in a chat dock.
- Hebrew default; mirrors lead's existing communication language if detectable.

**Not in scope:** generating long messages, marketing copy, multi-message campaigns.

---

## 6. PHASE 5 — WORKFLOW SUGGESTIONS

**Goal:** AI notices repeated user behavior and suggests a rule. The user opts in.

**Examples:** "you always add a follow-up task 3 days after status moves to 'in progress' — want this to happen automatically?"

**Hard constraints:**

- Suggestions are **explicit and one-time** — not ambient.
- Rules execute only after the user accepts. Acceptance is one click in a clearly labeled dialog.
- Acceptance writes a real, visible rule the user can edit or delete from a settings page.
- AI does not auto-create rules in the background.

→ See [`ai-safety-boundaries.md`](./ai-safety-boundaries.md), §2 (user-control invariant).

---

## 7. PHASE 6 — TOOL-CALLING AGENTS _(speculative)_

**Goal:** narrow agent loops that perform specific, auditable mutations.

**Preconditions** — none of these are negotiable:

- Phase 5 is shipped and trusted for at least one quarter.
- A complete audit log exists for every AI-initiated mutation, visible to the user.
- A confirmation step exists for every mutation, with full undo.
- Tool surfaces are narrow and named (e.g. `addTask`, `updateLeadStatus`) — not generic.

**Anti-pattern we will not ship:** an open-ended agent that "manages your CRM for you." Our users want control. AI accelerates control; AI does not replace it.

---

## 8. WHAT WE DO NOT BUILD — EVER, OR NOT YET

### 8.1 Will not build (off-brand for this product)

- A chat dock or chat page
- A floating AI assistant character / mascot / personality
- Voice input or voice output
- Image generation
- AI-generated marketing material
- Per-user model selection UI ("choose your AI")
- An "Ask the AI anything" surface

### 8.2 Will not build yet (until justified by usage)

- Vector DB / RAG (current data fits in the prompt)
- Real-time streaming UI (perceived speed via warm cache is enough)
- Background queue worker (after() handles current scale)
- Multi-modal input (image attachments to leads, etc.)
- Cross-tenant analytics

---

## 9. ANTI-PATTERNS OF SCOPE

These are the failure modes we have seen in similar products. Avoid all of them.

| Anti-pattern                                                 | Why it fails                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Building a chatbot first, then "intelligence features" later | Locks the product into conversational UX. We never recover the operational positioning.                                                                                                                                                                                                                           |
| Shipping cold-only AI surfaces                               | First impressions are slow → users decide AI is broken → they ignore it forever.                                                                                                                                                                                                                                  |
| One AI surface that does too much                            | Becomes a kitchen sink. Users don't trust it. We can't measure it.                                                                                                                                                                                                                                                |
| Adding AI to dashboards before per-entity AI is solid        | Aggregations expose hallucinations at scale. Trust collapses.                                                                                                                                                                                                                                                     |
| Building "AI settings" before AI is consistent               | Surfaces our internal trade-offs to users who do not care.                                                                                                                                                                                                                                                        |
| Letting AI drive notification **volume**                     | Users disable notifications, and now AI is invisible. Narrowed by DA-001: a notification produced under the Vigilance Notification Exception (`ai-safety-boundaries.md` §9.1) is not this anti-pattern — that path is deterministically gated and defaults to silence. AI choosing _how much_ to notify still is. |

---

## 10. SEQUENCING LOGIC — THE TASTE TEST

Before promoting an AI capability to the next phase, ask:

1. Did the **previous phase** survive a real editorial review on real customer data?
2. Did the previous phase add zero measurable latency to non-AI flows?
3. Did the previous phase stay inside its cost envelope for a full week?
4. Is the **next phase** built on the previous phase, or is it a new entrypoint?

If the next phase is a new entrypoint, ask harder: _do we actually need a new entrypoint, or are we just bored with the existing one?_

The product wins by **deepening** existing AI surfaces, not by **multiplying** them.

---

## 11. RELATIONSHIP TO PROJECT ROADMAP

This doc covers **AI** sequencing only. Non-AI roadmap concerns (lead import improvements, settings UX, etc.) are owned outside this folder. AI work yields right-of-way to non-AI work whenever the product's priority actions (`CLAUDE.md` §9) need attention.

---

## AMENDMENT HISTORY

Append-only.

- **DA-001 — The Vigilance Notification Exception (2026-08-25).** Narrowed this doc's
  prohibition on AI-driven notifications to a single deterministically gated path.
  The exception and its thirteen conditions are defined in
  [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §9.1 and are deliberately not
  restated here.
