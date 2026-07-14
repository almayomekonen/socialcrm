# claude/ai — AI Doctrine Index

These docs govern the AI surface of SocialCRM. They are **not generic AI notes** — they are the internal taste, boundaries, and discipline that keep the AI layer consistent as it expands.

Read this if you are about to build, change, or review anything that touches AI.

---

## Supreme doctrine (read before everything else)

[**intelligence-constitution.md**](./intelligence-constitution.md) is the highest governing document for all AI work in SocialCRM. It is philosophy only, immutable except by formal amendment, and every other doc, prompt, plan, and implementation here must **conform** to it. If any doc below conflicts with the constitution, the constitution wins and the conflict must be explicitly resolved (never left as silent divergence). See its Article 0 for the amendment and conflict-resolution protocol.

Immediately beneath it: [**theory-of-intelligence.md**](./theory-of-intelligence.md) defines _what intelligence and its parts actually are_ — the business-specific, technology-neutral definitions and laws (observation, evidence, belief, uncertainty, confidence, memory, attention, goals, planning, theory of mind, learning, failure modes, and how to judge quality) that any cognition must obey. It is governed by the constitution and sits **above** the cognitive architecture, which must implement it. It is **frozen and foundational at v1.1** (2026-07-13): it defines the universal cognitive primitives only — deliberately not an encyclopedia of business — so future work **builds on** it rather than expanding it; domain-specific theories (organizational cognition, reference classes, business economics, operator modeling, etc.) belong in the layers above, not here.

Beneath the theory: [**cognitive-architecture.md**](./cognitive-architecture.md) describes _how that intelligence thinks_ — the reasoning process. **Status: ratified & frozen (v2.1).** It was designed from scratch on top of the frozen theory (opening with a Design Rationale that selects a _resident world model governed by an attention-first executive loop_ against five alternatives), and every mechanism traces to a constitution article and a theory section/law. The superseded v1 is retained as a historical artifact at [`history/2026-07-13-cognitive-architecture-v1-superseded.md`](./history/2026-07-13-cognitive-architecture-v1-superseded.md) and is not doctrine. Do not confuse the cognitive architecture (how the mind works) with the two layers beneath it: the runtime architecture (how the mind is made to run) and the implementation doctrine (which technology builds it).

Beneath the cognition: [**ai-runtime-architecture.md**](./ai-runtime-architecture.md) defines _how that cognition is realized as runtime systems_ — nine technology-independent runtime systems (World Model Runtime, State Management, Memory Runtime, Event Interpretation, Context Assembly, Runtime Scheduler, Reasoning Runtime, Planning Runtime, Tool/Action Runtime) plus a cross-cutting Metacognition Runtime Layer (self-model, calibration, learning, and the model-independent correction channels — not a tenth system), their contracts, boundaries, data flow, and a safety spine that enforces the constitution's inviolable principles structurally. **Status: ratified & frozen (v1.1)** (2026-07-13). It _references_ every cognitive capability and never re-defines it, and it names no technology. Beneath it sits [`ai-architecture.md`](./ai-architecture.md), the technology-specific code/infra doctrine that _implements_ this runtime architecture. The machine stack is therefore: the theory is what intelligence is, the cognitive doc is how the mind thinks, the runtime doc is how the mind runs, and the architecture doc is the technology that builds it.

---

## Where to look first

| Question                                                                       | Doc                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| What should the intelligence fundamentally be? (supreme)                       | [intelligence-constitution.md](./intelligence-constitution.md) |
| What _is_ intelligence and its parts? (theory the cognition implements)        | [theory-of-intelligence.md](./theory-of-intelligence.md)       |
| How does the intelligence _think_? (cognition; ratified & frozen, v2.1)        | [cognitive-architecture.md](./cognitive-architecture.md)       |
| How is that cognition realized as runtime systems? (ratified & frozen, v1.1)   | [ai-runtime-architecture.md](./ai-runtime-architecture.md)     |
| Why is AI in this product at all?                                              | [ai-product-philosophy.md](./ai-product-philosophy.md)         |
| What text should the AI produce? Tone, banned phrases, examples.               | [ai-editorial-guidelines.md](./ai-editorial-guidelines.md)     |
| How should the code/infra be structured? (implements the runtime architecture) | [ai-architecture.md](./ai-architecture.md)                     |
| What should I build next, and what shouldn't I build yet?                      | [ai-roadmap.md](./ai-roadmap.md)                               |
| What must AI never do?                                                         | [ai-safety-boundaries.md](./ai-safety-boundaries.md)           |
| How should AI surfaces look and behave?                                        | [ai-ux-principles.md](./ai-ux-principles.md)                   |
| Am I ready to ship this AI feature?                                            | [ai-evaluation-checklist.md](./ai-evaluation-checklist.md)     |
| Is the existing AI surface trustworthy enough to expand?                       | [ai-verification-plan.md](./ai-verification-plan.md)           |

---

## Reading order for a new contributor

0. `intelligence-constitution.md` — the supreme doctrine; everything below conforms to it
1. `theory-of-intelligence.md` — what intelligence and its parts are (the cognition must implement this)
2. `cognitive-architecture.md` — how the intelligence thinks (ratified & frozen, v2.1; built on the theory)
3. `ai-runtime-architecture.md` — how the mind is made to run (ratified & frozen, v1.1; nine runtime systems + a cross-cutting metacognition layer; realizes the cognition, technology-independent)
4. `ai-product-philosophy.md` — calibrate taste
5. `ai-safety-boundaries.md` — calibrate trust
6. `ai-editorial-guidelines.md` — calibrate voice
7. `ai-architecture.md` — calibrate code patterns (the technology that implements the runtime architecture)
8. `ai-ux-principles.md` — calibrate interface
9. `ai-roadmap.md` — calibrate scope
10. `ai-evaluation-checklist.md` — gate every release
11. `ai-verification-plan.md` — gate every expansion

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
