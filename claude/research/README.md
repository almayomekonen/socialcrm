# research/ — Design & Product Research Knowledge Base

**Status:** Active
**Established:** 2026-08-09
**Owner of sign-off:** Creative Director

This directory is the permanent record of *why* we build things the way we do.
Each document captures research into how world-class products solve a problem, the
trade-offs considered, and the single direction we chose.

Research compounds. These are reusable assets, not one-off conversations. A person
joining this project two years from now should find what we know by reading folder
and file names alone — without knowing any document numbers.

---

## Where knowledge lives

| Directory | Holds | Lifecycle |
| --- | --- | --- |
| `claude/research/` | **Research** — how others solve a problem, options weighed, direction chosen | **Living.** Updated in place as we learn more |
| `docs/adr/` | **Decisions** — irreversible architectural choices | **Immutable.** Amended only by a superseding ADR |
| `claude/ai/` | **AI doctrine** — the constitution, theory, and architecture of the AI layer | **Governed.** Ratified and frozen by version |

If you are recording *what we learned and what we should do*, it belongs here. If you
are recording *a binding architectural choice*, write an ADR. If you are defining *what
the AI fundamentally is*, that is `claude/ai/`.

---

## Domain map

| Domain | Covers |
| --- | --- |
| `design/` | Visual language, motion, interaction patterns, component behaviour, states |
| `product/` | Product surfaces and features — what a screen is for and how it earns its place |
| `crm/` | The lead domain itself — lifecycle, statuses, triage, follow-up, workflows |
| `marketing/` | Public site, positioning, conversion, pricing presentation |
| `engineering/` | Implementation patterns — how a chosen direction is best built |
| `history/` | Superseded research, retained permanently. Never deleted |

**There is deliberately no `ai/` domain.** `claude/ai/` remains the canonical home for AI
doctrine and intelligence design. AI-related *research* is filed under the domain where
it is acted on — Copilot interaction research is `design/` or `product/`, not a separate
AI silo.

---

## Filenames

Descriptive, kebab-case, noun-first. The filename is the address.

```
design/motion.md
design/empty-states.md
product/copilot.md
crm/lead-lifecycle.md
marketing/pricing.md
```

- **No numeric IDs.** `RESEARCH-047.md` tells a newcomer nothing.
- **No dates in active filenames.** Dates belong in frontmatter.
- Only `history/` uses a date prefix, matching `claude/ai/history/`:
  `history/2026-08-09-hero-v1-superseded.md`

---

## Frontmatter

Every research document starts with:

```markdown
---
domain: design
status: proposed
last_updated: 2026-08-09
related: [product/copilot.md]
---
```

| Field | Meaning |
| --- | --- |
| `domain` | The folder it lives in. Must match its location |
| `status` | One of the four below |
| `last_updated` | `YYYY-MM-DD`. Bumped on every substantive edit |
| `related` | Paths to sibling research, relative to `claude/research/`. `[]` if none |

### Status values

| Status | Meaning |
| --- | --- |
| `proposed` | Researched and recommended. **Awaiting Creative Director approval** |
| `approved` | Direction approved. Not yet built |
| `implemented` | The approved direction shipped |
| `superseded` | Replaced by newer research. Lives in `history/` |

Status is what separates "an idea we pitched" from "the direction we shipped." Keep it
accurate or the knowledge base lies.

---

## Document structure

Every research document uses the same six sections, in this order:

1. **Observation** — what was observed during research
2. **Evidence** — concrete examples from the products actually inspected
3. **Common Pattern** — what those products consistently do
4. **Trade-offs** — advantages and disadvantages of each possible direction
5. **Recommendation** — exactly **one** direction
6. **Why this fits SocialCRM** — fit with our product, our users, our design system

Two hard rules:

- **Never state an opinion without evidence.** If it was not observed, it is not evidence.
- **Never present more than three options.**

---

## Working rules

**One canonical home per topic.** A topic lives in exactly one file, in the domain where
it is acted on. Cross-domain topics are *linked*, never duplicated. Two copies of the
same research means two versions of the truth, and one of them is wrong.

**Update, never recreate.** Before writing, check whether the topic already exists. If it
does, revise it in place and bump `last_updated`. Preserve the prior reasoning rather
than overwriting it — the reasoning is the asset.

**Supersede, never delete.** When research is genuinely replaced, set
`status: superseded`, move it to `history/` with a date prefix, and link forward to what
replaced it. We keep the record of what we used to believe and why we changed.

**Approval gate.** Research is produced by the Design Research Lead; direction is chosen
by the Creative Director. A document at `proposed` has not been agreed to. Nothing is
implemented from a `proposed` document.

**Add a domain README only when it earns its place** — when it provides navigation,
relationships, or authority that filenames alone cannot convey. Do not add one by
default; an index that only restates filenames is maintenance debt.

---

## Relationship to project rules

Research explores freely. Implementation does not.

Recommendations must land inside the existing design system: `CLAUDE.md` §13 (project
rules always win) and §14 (No Invention Rule), and `claude/ux-guidelines.md` §12. Where
research surfaces a pattern the product does not have, it is proposed explicitly as a new
pattern for the Creative Director to approve — never introduced silently.

Research records *why*. Code is the truth of *what shipped*. When they disagree, fix one
of them — never both at once.
