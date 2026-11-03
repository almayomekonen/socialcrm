# Load additional context

@claude/ux-guidelines.md
@claude/frontend-experience-guidelines.md
@claude/product.md
@claude/do-not-touch.md
@claude/architecture-rules.md
@claude/care-charter.md
@claude/release-deployment-workflow.md
@claude/i18n.md

---

# CLAUDE.md — Project Context

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

If a task instruction conflicts with CLAUDE.md rules:

→ CLAUDE.md rules ALWAYS win

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

---

## 15. SUPERPOWERS — PHASE 1 (PILOT)

Active skills: brainstorming, writing-plans, requesting-code-review,
receiving-code-review, systematic-debugging, verification-before-completion,
subagent-driven-development, dispatching-parallel-agents, using-git-worktrees
(the last three under the Tech Lead model in §17).

Disabled for Phase 1: test-driven-development, executing-plans,
finishing-a-development-branch, writing-skills.

The disabled list overrides the using-superpowers "you MUST invoke" pressure.
CLAUDE.md and claude/ai/\* override every skill.

Pilot artifacts land in docs/superpowers/ (gitignored). Pilot feature: Smart
Lead Summary. Expansion to Phase 2 requires validating workflow quality first.

---

## 16. NEON COST SAFETY RULE

NEON COST SAFETY RULE:
Never create a new Neon database branch as part of a normal deployment, preview deployment, PR, commit, feature branch, or development task. Reuse the existing development/staging database unless explicit database isolation is required. Creating a Neon branch requires an intentional reason. Temporary branches must have an automatic cleanup mechanism and expiration policy. Never modify or delete the production database/branch during cleanup.

Before introducing infrastructure that creates cloud resources automatically, evaluate whether resources accumulate over time and incur recurring costs.

Known cause (2026-09-28): the Vercel Neon integration resource `neon-rose-ribbon`
(Neon project `steep-king-36810887`) had its deployment action ("create a database
branch for each deployment") enabled for Preview + Production, which created a
branch per preview git branch and never deleted them (~50 extra branch-months,
~$77/month). That setting must stay OFF. Do not re-enable it. Since 2026-09-29 the
resource is connected to Production only; Preview has its own `DATABASE_URL`.

Permanent Neon branches (allowlist — nothing else is permanent):
- `main` (`br-soft-cell-amhmdjh1`, endpoint `ep-winter-star-am2xo52z`) — production, protected
- `preview-shared` (`br-fancy-mouse-amlasz65`, endpoint `ep-divine-pine-am0rjm7e`) — the
  single persistent Preview/Development database, protected. Every preview deployment
  uses it through the Preview-scoped `DATABASE_URL`. It is a copy of production data.
- the `card-trial-staging` resource (separate Neon project), only while it is in use

Any other branch is temporary: it needs an owner, a reason, and a deletion date.

---

## 17. PARALLEL DEVELOPMENT — TECH LEAD MODEL (DEFAULT FOR NON-TRIVIAL FEATURES)

For any non-trivial feature, the session acting as Tech Lead plans the work and,
where it is genuinely faster and safe, runs it in parallel with worker agents.
A small, single-file or tightly coupled change stays single-agent.

The Tech Lead:

1. Plans the feature and splits it into independent tasks with explicit
   contracts (files each task owns, interfaces, data shapes, what it must not touch).
2. Sizes concurrency to the work: the number of truly independent tasks, their
   dependencies, machine resources (disk, builds) and integration risk. Usually
   2–3 workers; more only when tasks are independent and resources allow.
3. Gives each worker its own git worktree and branch from the agreed base. Workers
   commit locally, never push, never build unless told, and stay in their worktree.
4. Reviews every worker diff against CLAUDE.md and claude/*.md, resolves overlaps
   deliberately on an integration branch, and verifies the whole feature (typecheck,
   build, relevant tests, regression against the base) before reporting.
5. Reports what each worker did, what was verified, and what remains.

Unchanged by this section: every approval gate in this file and in
claude/release-deployment-workflow.md (merge, deploy, production configuration,
migrations, external services), the Git rules (never develop on main, never rewrite
another branch), sensitive-area rules (§7), and the no-cost-surprise rules (§16).
Remove worker worktrees and their build output once their branches are integrated.

