# Load additional context

@Codex/ux-guidelines.md
@claude/frontend-experience-guidelines.md
@Codex/product.md
@Codex/do-not-touch.md

---

# AGENTS.md — Project Context

## 1. PROJECT OVERVIEW

- This is a **Social CRM**
- Used for managing leads sourced from social media
- Built with **Next.js**
- This is a **production system** — not a demo or prototype

---

## 2. CORE GOAL

The system must:

- Help users manage leads quickly
- Be understandable within **5 seconds**
- Drive user action within **10–20 seconds**

---

## 3. UX PRINCIPLES

- Clarity over complexity
- Action over features
- No confusing UI
- Every screen must guide the user toward a clear next step

---

## 4. CRITICAL RULES

- DO NOT break backend logic
- DO NOT modify DB schema
- DO NOT rename API fields
- DO NOT remove existing functionality
- DO NOT refactor unless explicitly asked

---

## 5. KEY USER FLOW

```
User logs in → sees empty state → uploads leads → sees leads → continues using system
```

---

## 6. TERMINOLOGY

**Use:**

- `לידים` (leads)
- `נציג` (agent/rep)

**Avoid:**

- Insurance terms such as `סוכן`

---

## 7. SENSITIVE AREAS

The following areas are **dangerous** — do not modify without explicit instruction:

- **Authentication** — Google login flow
- **Permissions** — `user_perms` logic
- **transferSales** — commission/transfer logic
- **DB joins** — any cross-table query logic

---

## 8. DECISION RULE

Before making any change, always ask:

1. Does this make the system **clearer**?
2. Does this help the user **act faster**?

If the answer to both is not yes → **do not implement.**

---

## 9. PRIORITY ACTIONS

The system must always prioritize:

1. Adding leads
2. Importing leads (Excel upload)
3. Viewing leads
4. Managing leads

Any UI or feature should support one of these actions.

---

## 10. WHAT NOT TO BUILD

This system is NOT:

- Not an insurance system
- Not an enterprise ERP
- Not a complex multi-step workflow system

Avoid:

- Over-engineering
- Adding unnecessary features
- Creating complex flows when a simple action is enough

---

## 11. Data Display Rules

- Never show meaningless data (e.g. values that are always 0)
- Hide metrics that are not functional yet
- Only display data that helps the user take action
- Avoid misleading or empty summary cards

---

## 12. DESIGN SYSTEM ENFORCEMENT

CRITICAL:

- Do NOT use emojis in UI
- Do NOT invent new UI components
- Do NOT create new layouts or sections

You MUST:

- Reuse existing components
- Reuse existing icons
- Match existing spacing and styles exactly

If unsure:
→ Copy an existing component pattern
→ Never invent a new one

---

## 13. RULE PRIORITY

If a task instruction conflicts with AGENTS.md rules:

→ AGENTS.md rules ALWAYS win

Never override system rules with task-specific instructions.

---

## 14. NO INVENTION RULE

Do not invent:

- UI elements
- UX patterns
- Data displays
- Features

Only use patterns that already exist in the codebase.

If something does not exist:
→ Ask before implementing

## Entity Constraint

The system has only one entity: Lead.

Never introduce a separate "Client" entity, page, or model.

Closed leads are considered clients.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
