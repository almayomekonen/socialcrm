# claude/ai — AI Doctrine Index

These docs govern the AI surface of SocialCRM. They are **not generic AI notes** — they are the internal taste, boundaries, and discipline that keep the AI layer consistent as it expands.

Read this if you are about to build, change, or review anything that touches AI.

---

## Supreme doctrine (read before everything else)

[**intelligence-constitution.md**](./intelligence-constitution.md) is the highest governing document for all AI work in SocialCRM. It is philosophy only, immutable except by formal amendment, and every other doc, prompt, plan, and implementation here must **conform** to it. If any doc below conflicts with the constitution, the constitution wins and the conflict must be explicitly resolved (never left as silent divergence). See its Article 0 for the amendment and conflict-resolution protocol.

---

## Where to look first

| Question                                                         | Doc                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| What should the intelligence fundamentally be? (supreme)         | [intelligence-constitution.md](./intelligence-constitution.md) |
| Why is AI in this product at all?                                | [ai-product-philosophy.md](./ai-product-philosophy.md)     |
| What text should the AI produce? Tone, banned phrases, examples. | [ai-editorial-guidelines.md](./ai-editorial-guidelines.md) |
| How should the code/infra be structured?                         | [ai-architecture.md](./ai-architecture.md)                 |
| What should I build next, and what shouldn't I build yet?        | [ai-roadmap.md](./ai-roadmap.md)                           |
| What must AI never do?                                           | [ai-safety-boundaries.md](./ai-safety-boundaries.md)       |
| How should AI surfaces look and behave?                          | [ai-ux-principles.md](./ai-ux-principles.md)               |
| Am I ready to ship this AI feature?                              | [ai-evaluation-checklist.md](./ai-evaluation-checklist.md) |
| Is the existing AI surface trustworthy enough to expand?         | [ai-verification-plan.md](./ai-verification-plan.md)       |

---

## Reading order for a new contributor

0. `intelligence-constitution.md` — the supreme doctrine; everything below conforms to it
1. `ai-product-philosophy.md` — calibrate taste
2. `ai-safety-boundaries.md` — calibrate trust
3. `ai-editorial-guidelines.md` — calibrate voice
4. `ai-architecture.md` — calibrate code patterns
5. `ai-ux-principles.md` — calibrate interface
6. `ai-roadmap.md` — calibrate scope
7. `ai-evaluation-checklist.md` — gate every release
8. `ai-verification-plan.md` — gate every expansion

---

## Companion docs (already exist)

- [`/claude/CLAUDE.md`](../CLAUDE.md) — overall project rules
- [`/claude/product.md`](../product.md) — user, problem, value
- [`/claude/ux-guidelines.md`](../ux-guidelines.md) — non-AI UX rules (still apply)
- [`/claude/do-not-touch.md`](../do-not-touch.md) — protected systems

When AI doctrine and project doctrine conflict, **project doctrine wins** (see `CLAUDE.md` §13).

---

## Source-of-truth pointers

| Concern                               | File                                          |
| ------------------------------------- | --------------------------------------------- |
| Prompt definitions, schema, sanitizer | `lib/ai/prompts/leadIntelligence.ts`          |
| Provider router, fallback chain       | `lib/ai/router.ts`                            |
| Per-entity caching                    | `actions/ai/leadIntelligence.ts`              |
| Background pre-warm                   | `lib/ai/prewarm.ts`, `lib/ai/scheduleWarm.ts` |
| Manual refresh action                 | `actions/ai/leadIntelligenceRefresh.ts`       |

Docs describe the **doctrine**. Code is the **truth**. When they disagree, fix the docs or fix the code — never both at once.
