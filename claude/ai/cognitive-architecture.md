# The SocialCRM Cognitive Architecture (v2.1 — ratified)

> How SocialCRM Intelligence **thinks**. Not what it is (that is the [Constitution](./intelligence-constitution.md)), not what its thoughts are made of (that is the [Theory of Intelligence](./theory-of-intelligence.md)), not how it is built (that is `ai-architecture.md`). This document describes the *thinking process itself*, designed to outlive any particular technology.

---

| Field | Value |
| --- | --- |
| Version | 2.1 |
| Status | **Ratified & FROZEN at v2.1 (2026-07-13)** — the current canonical cognition layer for SocialCRM Intelligence; governed by the Constitution; **implements** the frozen Theory of Intelligence v1.1 |
| Scope | Cognition only. No implementation, code, prompts, models, tools, APIs, databases, schedules, evaluation metrics, or roadmap. |
| Governs | Every future architectural and engineering decision that touches how the AI reasons. |
| Built on | [`intelligence-constitution.md`](./intelligence-constitution.md) (supreme) and [`theory-of-intelligence.md`](./theory-of-intelligence.md) (frozen, foundational). |
| Supersedes | v1, retained as a historical artifact at [`history/2026-07-13-cognitive-architecture-v1-superseded.md`](./history/2026-07-13-cognitive-architecture-v1-superseded.md). v2 does **not** inherit from it. |
| Revisions | v2.1 — focused consistency pass after adversarial review: explicit pre-attentive coverage tier (D); coverage floor vs variable depth (1.12, D); earned vs structurally-uncalibratable confidence (E); model-independent self-correction channels (G); attention controller separated from executive reasoning (D, H); salience-admission separated from portfolio triage (D, H); earned autonomy as a first-class belief (K, J); relationship narrative protected from forgetting (G). No redesign, no new doctrine, no scope change. |
| Mutability | Frozen. The architecture is stable; it changes only through a deliberate, versioned revision that stays philosophy-level, technology-neutral, Constitution-conformant, and Theory-conformant. Deferred refinements (below) are candidates for a future revision, not silent edits. |

> **Freeze note.** This document is the ratified, frozen cognition layer. It defines *how the intelligence thinks* and nothing else. The next phase — **AI Architecture** (`ai-architecture.md`) — must *implement* this cognition, never modify it; where the two ever disagree, the engineering doc is wrong until reconciled (Constitution Article 0.4).

> **One-line thesis.** A resident, multi-scale, temporal **world model** is the mind's centre of gravity; a continuous loop keeps it live; an **attention controller** decides where the mind's own cognition and the operator's scarce attention go; within the attended region the mind reasons in a **hypothesis-driven** style, **plans** when a relationship needs a campaign, and expresses itself only through the **reversibility-gated** four choices — act, recommend, ask, or stay silent.

### What this document is, and is not

- It **is** a cognitive architecture: the structure of the thinking. It never names a mechanism, technology, data structure, or model.
- It is **not** a software architecture (`ai-architecture.md`), which must merely *implement* this cognition; when the two disagree at different altitudes, the engineering doc is wrong until reconciled.
- It is **not** the Theory: the Theory says *what* observation, belief, goal, action, etc. are; this doc says *how* the mind moves through them. Every mechanism here cites the Theory section or law, and the Constitution article, it implements.
- It is **governed by** the Constitution (Article 0.1) and **conformant to** the frozen Theory (Theory §0.4). Where any conflict arises, the Constitution wins, then the Theory; the conflict is resolved explicitly, never left as silent divergence (Constitution Article 0.4). Part 4 makes conformance auditable.
- It is **revisable** as understanding of cognition deepens, provided every revision stays philosophy-level, technology-neutral, Constitution-conformant, and Theory-conformant.

---

## Part 0 — Design Rationale (architecture selection)

This architecture was **chosen against alternatives**, not assumed. Six fundamentally different cognitive architectures — each of which *could* be made to conform to the Constitution and the Theory — were compared. The selection matters because the organising choice propagates into every downstream decision for a decade.

A framing that governs the whole comparison: these six candidates are **not peers at one level**. Some are claims about the *substrate* (what persists), some about *control* (what drives the cycle), some about *reasoning style* (how one judgment forms). The Constitution and Theory constrain each layer differently, so the honest question is not "which one wins" but "which one wins *at its layer*, and what becomes subordinate."

### 0.1 The candidates

**Candidate A — World-model-centric.** *Centre:* a standing, multi-scale, temporal model of every relationship and the business; all cognition reads and writes it.
- *Strengths:* continuity, "knows things you were never told," and questions-as-reads all fall out for free.
- *Weaknesses:* says what persists, not what drives thinking or how finite attention is spent; pure form risks a beautiful model no one acts on, or uniform updating that a bounded mind cannot afford.
- *Cognitive tradeoff:* maximises coherence and continuity; underspecifies triage and volition.
- *Maintainability:* very high — one durable substrate; faculties attach without reshaping the core.
- *Faithfulness to Constitution:* highest — Article I.1 defines the unit of intelligence as "the continuously-maintained belief about the state of the world"; Article XII centres the world model.
- *Faithfulness to Theory:* highest at the substrate layer (§3.10, §3.23, §3.6); silent on §3.13 attention and §3.16 planning by itself.

**Candidate B — Planner-centric.** *Centre:* goals decomposed into hierarchical plans; perception serves plan execution and replanning.
- *Strengths:* native home for §3.16 planning and campaigns toward the next commitment; forward-looking and committing (Article X).
- *Weaknesses:* subordinates perception to the active plan, so it under-notices what no plan is looking for — precisely the "surface what you didn't ask" value (Article X, III.1); prone to plan-fixation (a Part 5 failure).
- *Cognitive tradeoff:* strong volition, weak vigilance and peripheral awareness.
- *Maintainability:* medium — plan schemas proliferate; the model becomes an appendage of the planner.
- *Faithfulness to Constitution:* partial — serves VII/X but tends to violate I.3 vigilance and III.4 restraint.
- *Faithfulness to Theory:* over-weights §3.16 at the expense of §3.13, §3.5/§3.9, §3.21. Planning is a *faculty* in the Theory, not the centre.

**Candidate C — Event-driven (reactive).** *Centre:* incoming events fire handlers that update beliefs and maybe act; the model is side-state.
- *Strengths:* excellent latency on fresh signals and deadlines; time and absence handled naturally (§3.22).
- *Weaknesses:* this is the failure the Constitution names first (Article IV.1: "reactive, not resident"). Between events it thinks nothing; no endogenous investigation, portfolio reflection, or self-audit.
- *Cognitive tradeoff:* buys responsiveness, loses residency and reflection.
- *Maintainability:* low–medium — handler sprawl; emergent behaviour hard to reason about.
- *Faithfulness to Constitution:* low — contradicts I.1 and IV.1.
- *Faithfulness to Theory:* captures §3.22 triggers but violates the standing-model spirit of §3.10 and the endogenous half of §3.13. **Rejected as a centre**; retained only as one trigger source.

**Candidate D — Hypothesis-driven (differential diagnosis).** *Centre:* competing hypotheses about each relationship and the business, tested by diagnostic evidence to reduce uncertainty.
- *Strengths:* the Theory's epistemic core made literal — §3.5 diagnosticity, disconfirmation-first, §3.9 predictive test, §3.7 epistemic-vs-aleatoric; blessed by Constitution V; structurally resists premature conclusion and overconfidence.
- *Weaknesses:* an inference *style*, not a whole cognition — it does not itself decide which relationships to attend to, how to plan a campaign, or how to gate action; pure form over-investigates (resolving uncertainty that would not change the decision — violates §3.9 sufficiency).
- *Cognitive tradeoff:* maximises epistemic quality; underspecifies attention economics and volition.
- *Maintainability:* high within the belief layer; incomplete overall.
- *Faithfulness to Constitution:* strong on II, V, VIII, IX; silent on VI (allocation) and VII (action gate).
- *Faithfulness to Theory:* faithful to §3.5–§3.9; incomplete on §3.13, §3.16, §3.19. Best kept as the reasoning style *inside* the substrate.

**Candidate E — Executive-loop (situational awareness / OODA).** *Centre:* a continuous perceive→comprehend→project→judge→act loop — Article XII taken as the literal architecture.
- *Strengths:* it is the Constitution's own picture of the mind (Article V, XII); guarantees residency and outcome feedback.
- *Weaknesses:* taken literally it becomes a pipeline — and the Theory records that v1 *broke as a pipeline* (perception is theory-laden and top-down, §3.4, not a clean first stage). Article XII itself disclaims being an architecture ("mandates no particular mechanism"). A loop is not a scheduler and says nothing about what persists.
- *Cognitive tradeoff:* clear cadence; risk of rigid stage-ordering and shallow uniform passes.
- *Maintainability:* medium — stages tempt sequential handoffs that fight §3.4.
- *Faithfulness to Constitution:* high as *shape*; misleading if reified as *mechanism*.
- *Faithfulness to Theory:* good on continuity and feedback; at risk on §3.4 and §3.13. Best used as macro-cadence, not centre.

**Candidate F — Attention-first (bounded-resource scheduler).** *Centre:* allocation of finite attention — a scheduler decides what to think about and what the operator sees; every faculty is invoked by attention.
- *Strengths:* directly implements the scarcest thing in the system — Theory §3.13 (two economies), Law 6, Constitution III.4 / VI / VII.1 (deciding what is *not* worth attention is a named AI-owned decision), XI.5; structurally fights drowning, tunnelling, and alarmism.
- *Weaknesses:* attention presupposes something to allocate *over* and *toward*; pure attention-first with a thin model triages shallow state and understands nothing deeply.
- *Cognitive tradeoff:* maximises triage and restraint; depends on a substrate to be worth scheduling.
- *Maintainability:* high as a control layer — one policy governs where effort goes.
- *Faithfulness to Constitution:* very high on III.4, VI, VII.1, XIII.
- *Faithfulness to Theory:* highest at the *control* layer (§3.13, §3.19, §3.26, Laws 6, 16); needs the substrate beneath it.

### 0.2 The decision and its justification

The comparison shows the real contest is only at two layers, and each source names a clear winner:

- **Substrate (what persists):** **world-model-centric** wins outright. Constitution I.1 and Theory §3.10/§3.23 leave no room for anything else; event-driven and planner-centric *lose here* because they demote the model.
- **Control (what drives the cycle and spends the scarce resource):** **attention-first** wins. Theory §3.13/Law 6 and Constitution III.4/VI/VII.1 make finite attention the executive spine.

The remaining three are not centres at all: **hypothesis-driven** is the correct *reasoning style* inside the substrate; **planning** is a *faculty* invoked when a relationship needs a campaign; **executive-loop** is the correct *macro-cadence* (residency + feedback) but not a mechanism; **event-driven** survives only as one *trigger source*.

> **Selected architecture: a resident world model governed by an attention-first executive loop.**
> The centre of gravity is a standing, multi-scale, temporal world model. A continuous loop keeps it live (residency + outcome feedback, the Article XII shape). An attention controller — a mandatory pre-attentive coverage pass, then endogenous salience scoring surprise, goal-relevance, and time-criticality — decides what earns the mind's own cognition and the operator's scarce attention; the risk-adjusted economic comparison across the admitted set is portfolio triage, done by executive reasoning, not by the controller. Within the attended region, cognition reasons in the hypothesis-driven style, invokes planning when a relationship needs a campaign, and expresses itself only through the reversibility-gated four choices: act, recommend, ask, or stay silent.

Why it is superior to each alternative *as an organising centre*: it is the only candidate that satisfies **both** non-negotiable mandates at once — residency (Constitution I.1) and bounded attention (Theory Law 6) — while assigning every rejected candidate the subordinate role the Theory already gives it, so nothing valuable is lost and no law is violated. It resists the widest span of the Theory's Part 5 failure modes structurally: staleness (the loop decays and re-attends), drowning/tunnelling and alarmism (the attention controller), premature conclusion and overconfidence (the hypothesis style), reactivity (residency), and fabrication (the inferential-distance discipline). And it is the most maintainable because responsibilities separate into five cleanly-evolvable layers: **substrate / control / reasoning-style / faculty / gate**.

The rest of this document specifies that architecture.

*Implements:* Constitution I.1, III.4, IV.1, V, VI, VII.1, XII; Theory §3.10, §3.13, §3.19, §3.23, Laws 6, 16.

---

## Part 1 — The cognitive environment (Engineering Reality)

Before designing cognition, we fix the environment it must inhabit. This is **not** software architecture; it is the *physics* of the world the mind lives in. Each constraint is stated with the cognitive commitment it forces — because a faculty that ignores its environment is not intelligence, it is theatre. This part is the reason the later parts take the shape they do.

1. **The world is hidden; the record is a shadow.** The true state of a relationship is never directly visible; the CRM holds corrigible, source-weighted traces, not truth. *Forces:* the mind reasons over inferred latent state, always across an observer gap represented as uncertainty, never treating a field as the fact. (Theory Part 2, §3.2, §3.3, Law 3.)
2. **Signals are noisy and unequally reliable.** A system timestamp and a hand-typed sentiment note are not equally trustworthy. *Forces:* every observation is weighted by source reliability before it moves a belief. (Theory §3.3.)
3. **Absence is information.** The reply that never came, the deadline that passed untouched, silence longer than this relationship's rhythm are among the most informative signals — and they are never recorded as events. *Forces:* the mind must actively look for what is *not* there, not only process what is. (Theory §3.3, §3.22; Constitution II.)
4. **Outcomes are mostly censored and always delayed.** Most predictions never cleanly resolve; the lead simply goes quiet, fate unknown. *Forces:* learning, calibration, and self-knowledge must work under censoring — never discarding unresolved cases, never imputing outcomes. (Theory §3.27, Law 15.)
5. **Time changes meaning.** Elapsed duration, cadence, deadlines, and windows are constitutive of state; "overdue" and "the right moment" are judged against a relationship's rhythm, not a clock. *Forces:* the model is a trajectory, and confidence decays with un-refreshed time. (Theory §3.22, §3.12, Law 14.)
6. **Goals are plural, conflicting, and owned by another agent.** The operator holds several objectives at once; some are constraints, not maximands; and they are the operator's to set. *Forces:* value is goal-relative, the mind acts on the admissible (non-dominated) set, and genuine conflicts between the operator's own goals are escalated, not silently traded. (Theory §3.14, §3.15, Laws 7, 8; Constitution VII.2.)
7. **Multiple operators collaborate under permission scopes.** "The human" is never generic. *Forces:* goals, memory, and relationship ownership are scoped to actor and role; one operator's intent is never applied to another's relationships. (Constitution VII.5.)
8. **The target is non-stationary.** The business, the market, and the relationships move; there is no final correct model to converge on. *Forces:* perpetual learning *and* forgetting; the mind must be able to notice its own frame has drifted. (Theory §3.21, §3.12, Law 10.)
9. **Relationships evolve and are the unit of the work.** The object that matters is the persistent dyad with its history, latent state, trajectory, commitments, cadence, and next step — not the message or the record. *Forces:* cognition maintains relationships as first-class objects over time, and never lets one collapse into its status field. (Theory §3.23.)
10. **Attention is scarce on both sides.** Neither the mind nor the operator can attend to everything; every act of attention is an act of non-attention elsewhere. *Forces:* an explicit attention economy governing the mind's own effort and the operator's, with real opportunity cost. (Theory §3.13, §3.26, Law 6.)
11. **Trust is fragile and asymmetric.** One confident error, one silently dropped ball, one hallucinated fact outweighs many quiet wins. *Forces:* the mind is built around loss-aversion — it must fear the confident error more than the admitted gap. (Constitution VIII, XI; Theory Part 5.)
12. **Cost and latency exist — but must never deform cognition.** Compute, time, and interruption are real and finite. *Forces:* resources may bound the *depth* of reasoning on any item and *how far* a plan branches — but they may bend neither the **coverage floor** nor the **standards**. The coverage floor is the mandatory shallow pass over *every* live relationship sufficient to detect a dropped ball (the pre-attentive tier, Part D); its breadth never shrinks under load, because a relationship dropped for want of a cheap glance is the cardinal failure (Constitution XI.4, VI.4). The standards — calibration where it is earnable, non-fabrication, the observation/inference separation, the reversibility gate, and honest uncertainty — hold identically whether the mind has a millisecond or an hour. Depth of reasoning is elastic; coverage and honesty are not. A cheaper answer may be shallower; it may never be less honest, and it may never silently skip a relationship. (Constitution VI.4, VIII, IX, XI, XI.4; Theory §3.1, §3.8, §3.13.)

*Implements:* Theory Part 2, §3.2, §3.3, §3.12, §3.13, §3.14, §3.15, §3.21, §3.22, §3.23, §3.26, §3.27, Laws 3, 6, 7, 8, 10, 14, 15; Constitution II, IV.1, VI.4, VII.2, VII.5, VIII, IX, XI.

---

## Part 2 — The cognition (how it thinks)

### A. The architecture in one idea

The mind is five layers, always running together, not a line from input to output:

- **Substrate** — a resident world model of relationships and the business (Part B).
- **Control** — an attention *controller* that schedules where cognition and the operator's focus go (Parts C, D): a mandatory pre-attentive coverage pass over every live relationship, then endogenous salience that decides which candidates earn deep cognition and which reasoning lens applies. It schedules; it does not itself reason.
- **Reasoning** — hypothesis-driven comprehension that turns traces into calibrated belief and belief into understanding (Parts E, F), operating at two scales: single-relationship depth and the portfolio lens of executive reasoning that triages across the admitted set (Part H). This is what the controller feeds; it is never the controller itself.
- **Faculty** — planning, invoked when a relationship needs a multi-step campaign (Part I).
- **Gate** — the reversibility-bound choice of act / recommend / ask / stay silent (Part J).

It is a **cycle, not a pipeline**, for one reason the Theory makes unavoidable: perception is theory-laden (§3.4). There is no clean "observe first, interpret later" stage, because what the mind notices is already shaped by what it expects. So the loop is drawn as *the model predicting, the world answering, and the gap between them driving everything* — never as a conveyor belt. Metacognition (Part G) sits above the whole cycle, watching the cycle's own errors.

*Implements:* Constitution I.1, XII; Theory §3.4, §3.10, §3.13; Part 0 selection.

### B. The centre of gravity: the standing world model

Cognition maintains one thing above all: a **resident world model** that exists between questions. A question is a *read* against it; an event is a *write* to it; but the model is never summoned into being by either (Constitution I.1).

The model has three essential properties, each mandated by the Theory:

- **It is multi-scale.** It holds each **relationship** as a first-class object — counterpart, history, latent state, trajectory, mutual commitments, cadence, and the next commitment that would be progress — *and* it holds the **portfolio**: cohorts, sources, and business-level state that are invisible relationship-by-relationship. Some truths live only at the portfolio scale (a source is degrading), so a mind that models only single relationships is blind to the business. (Theory §3.10, §3.23; Constitution VI.1.)
- **It is temporal.** Every belief is located in time and carries a trajectory: where the relationship has been, is, and is heading. Trend is part of state, not an afterthought computed on demand. (Theory §3.10, §3.22.)
- **It is populated by beliefs, not facts.** Every entry is a graded bet with the five-part anatomy of Theory §3.6 — content, confidence, evidence for *and against*, freshness, groundedness. A claim that cannot cite its evidence or state its confidence is a rumour, and the mind may not hold it. (Theory §3.6; Constitution VIII.2, XI.8.)

The world model *is* the intelligence, in the Constitution's sense: when the human asks, the mind is not computing an answer but reporting a conclusion it already reached.

*Implements:* Constitution I.1, V, VI.1, VIII.2, XI.8, XII; Theory §3.6, §3.10, §3.22, §3.23.

### C. How thinking begins

Thinking does **not** begin with the human's question. It begins from one of three endogenous triggers, and the question is a fourth, occasional entry that is merely a read:

1. **A new trace arrives** — a message, an event, an outcome — and is compared against what the model predicted. Confirmation quietly strengthens; violation (surprise) demands cognition. (Theory §3.4; Constitution XII.)
2. **Time passes** — a deadline lapses, a cadence is missed, a belief's freshness decays past a threshold. Elapsed time is itself a trigger, which is how the mind notices the reply that never came. (Theory §3.22, §3.12; Constitution II.)
3. **The self-model flags staleness or drift** — a region of the model has gone too long unobserved, or accumulated surprise suggests the frame itself is wrong (Part G). The mind schedules attention on itself. (Theory §3.21, Law 11.)

Because the mind is already watching, already predicting, and already surprised before any question is posed, it can know things the human never asked about — the Constitution's first sign of intelligence.

*Implements:* Constitution I.1, III.1, XII; Theory §3.4, §3.12, §3.21, §3.22, Law 11.

### D. How it notices something important (the attention controller)

The triggers in Part C generate far more than a bounded mind can think hard about, and far more than the operator could ever attend to. **Attention is the control system** — the *scheduler* of a bounded mind. It only schedules and admits; it does not itself reason (the portfolio reasoning it feeds lives in Part H). Choosing what to ignore is the essence of attention, not a side effect (Theory §3.13, Law 6).

The controller runs in **two tiers**, and the distinction resolves the bootstrap problem of a mind that would otherwise have to think about everything in order to decide what to think about:

- **Tier 1 — the pre-attentive coverage pass (mandatory, cheap, universal).** A shallow pass runs over **every live relationship**, computing only *low-inference* expectations — a lapsed cadence, a passed deadline, an absence longer than this relationship's rhythm, a coarse value band. Because it needs no deep comprehension, it can afford to be universal, and it never has to have already reconstructed a relationship in order to flag it. Its job is *coverage*: to guarantee that nothing goes dark undetected. This tier is a **floor** (Part 1.12): its breadth is never reduced under resource pressure, because to skip a relationship here is to risk the silently dropped ball the Constitution forbids (Constitution XI.4, VI.4).
- **Tier 2 — endogenous salience (admission to deep cognition).** From the candidates Tier 1 flags, this tier decides which few earn the mind's *deep* attention now, and which reasoning lens (Part H) they demand — accepting shallow treatment of the rest. This is where scarce cognitive attention is genuinely rationed.

Both tiers serve **two distinct attention economies**, and the mind must never confuse them: **its own cognitive attention** (which relationships to reconstruct deeply now) and **the operator's attention** (the scarcest resource in the system, spent only by what the mind chooses to surface, Part J).

Admission at both tiers is scored, not counted, by factors the Theory supplies — **surprise** (prediction error: coarse against low-inference expectations at Tier 1, full at Tier 2; Theory §3.4), **goal-relevance** (Theory §3.14, Law 7), and **time-criticality** (Theory §3.22). Salience answers only one question — *does this earn cognition at all?* The full **risk-adjusted economic comparison** across the admitted set — value against cost and time, where attention changes outcomes most — is **portfolio triage**, and it belongs to executive reasoning (Part H), not here. Keeping detection (this Part) separate from comparative allocation (Part H) stops the two layers from doing the same work twice.

This is the layer that structurally prevents *drowning* (signal lost in noise) and *tunnelling* (depth on the wrong thing); and Tier 1 specifically prevents the third named failure, the silently dropped ball.

*Implements:* Constitution III.4, VI.4, VII.1, XI.4; Theory §3.4, §3.13, §3.14, §3.22, Laws 6, 7; Part 5 (attention failures).

### E. From traces to beliefs (comprehension)

Inside an attended region, the mind turns traces into belief. Because perception is theory-laden (§3.4), there is no pure-observation stage; instead the mind maintains a **discipline of inferential distance**: every claim is tagged by how far it sits from the trace, on a gradient from low-inference ("a message was recorded 9 days ago") to high-inference ("this relationship is dying"). The mind must always be able to climb back down that gradient to the traces beneath any conclusion, and must never present a high-inference claim as a low-inference one. This gradient — not a mythical neutral bottom layer — is what implements the Constitution's fabrication ban and observation/inference labelling. (Theory §3.4; Constitution XI.1, IX.5.)

An observation becomes **evidence** only against a hypothesis, and its worth is its **diagnosticity** — how sharply it discriminates between live explanations — not its volume or vividness. **Disconfirming evidence is first-class**: a belief records what argues *against* it as well as *for* it, because a mind that gathers only confirmation feels certain and is wrong. (Theory §3.5, §3.6; Constitution VIII, XI.3.)

The resulting **belief** carries the full anatomy of §3.6, and its **confidence is a calibrated promise about frequency** — never a feeling, never fluency, never emphasis. But calibration presupposes observable outcomes, and most outcomes are censored (Part 1.4), so confidence divides into two kinds the mind must never conflate. **Earned-calibratable** confidence sits on the minority of predictions whose outcomes do resolve; here calibration is a hard, honored standard, and claiming a calibration one has not earned is prohibited. **Structurally-uncalibratable** confidence sits on beliefs whose outcomes the world will likely never reveal; here the mind marks the belief low-groundedness, widens its uncertainty, and *says so*, rather than emitting a frequency promise it can never keep. The prohibition, precisely stated, is on *claiming unearned calibration* — not on holding beliefs where calibration is unobtainable; a confident number over a censored outcome is the lie with a number attached. Uncertainty is represented in two kinds (epistemic vs. aleatoric — only the epistemic is worth investigating) and two orders (the credence, and how well-grounded it is — groundedness carries this calibratable/uncalibratable status). (Theory §3.7, §3.8, §3.27; Constitution IX, XI.3.)

*Implements:* Constitution IX, IX.5, XI.1, XI.3, VIII; Theory §3.3, §3.4, §3.5, §3.6, §3.7, §3.8, §3.27, Laws 2, 4, 5.

### F. From beliefs to understanding (hypotheses and sufficiency)

Comprehension proceeds in the **hypothesis-driven style** (the reasoning-style layer, chosen in Part 0). When observations admit more than one explanation, the mind holds the explanations **in parallel** — *cold vs. merely busy* — each with a confidence, and advances primarily by **disconfirming the weak ones**, not by building a case for the favourite. Whenever hypotheses remain live, the mind names the single cheapest observation that would most separate them, which makes uncertainty actionable and defines exactly what it is waiting for. (Theory §3.5, §3.9; Constitution V, IX.3.)

To **understand** is to hold a model that both **predicts** (anticipates the next traces) and **explains** (identifies the causes) well enough to choose the right action. Understanding is tested two independent ways, and needs both — which is what keeps "enough" from being circular:

- **Predictive test** — does the model correctly anticipate what the relationship does next? A fluent narrative that cannot predict does not understand.
- **Decision test (sufficiency)** — would the plausible further things the mind could learn change the action it would take? If not, understanding is *sufficient for this decision*.

Sufficiency is **decision stability scaled by stakes**, never completeness: the mind stops investigating when the value of further information falls below its cost at the stakes-appropriate threshold — a rough read for a trivial reversible nudge, a high bar near an irreversible outcome. Only epistemic uncertainty is worth resolving; spending effort on the genuinely aleatoric is waste. (Theory §3.7, §3.9; Constitution II, IX.)

*Implements:* Constitution II, V, IX, IX.3; Theory §3.5, §3.7, §3.9, Laws 2, 4.

### G. Keeping the model honest (learning, forgetting, metacognition)

A mind that cannot doubt itself is dangerous, and one that cannot forget cannot stay accurate in a moving world. This layer keeps the substrate true over time.

- **Belief update.** Evidence shifts confidences up and down, in the spirit of Bayesian revision, and every update honours evidence *against* as much as *for*. (Theory §3.18.)
- **Structural learning.** When the existing categories stop predicting — a source now behaves as two populations — the mind changes the *structure* of the model, not just its confidences. Structural change is rarer and heavier, and is triggered by accumulated, one-directional surprise. (Theory §3.18, §3.10.)
- **Forgetting, deliberately — with a protected floor.** Confidence **decays** with un-refreshed time so a stale conclusion is not reported as current; many episodes **consolidate** into durable base rates; beliefs and categories that no longer predict are **pruned**. Retention is not free and more is not better; the right memory is the *useful* memory. But forgetting is **partitioned**: only *predictive clutter* — decayable confidences, redundant episodes, dead categories — is eligible. The **relationship narrative — its history, the promises made by each side, and the outcomes that befell it — is a floor that is never pruned or consolidated away**, because losing it is the amnesia the Constitution forbids and the loss of the very object the mind exists to steward (Constitution III.2, XI.7; Theory §3.23). Consolidation may compress *how* a narrative is stored; it may never erase *that* it happened. (Theory §3.11, §3.12, §3.23, Law 10; Constitution III.2, XI.7.)
- **Memory in three forms.** The mind carries **episodic** memory (specific remembered cases, which enable recognising a new situation as *like* a known one), **semantic** memory (base rates that keep it non-naive), and **procedural** memory (retained know-how). Reducing memory to priors alone would make case-based recognition impossible. (Theory §3.11; Constitution III.2.)
- **The self-model.** The mind models its *own* reliability: where it tends to be wrong, which regions are stale, how well-calibrated it has been lately. Its signals must **never all derive from the model itself**, or a badly-drifted model would police its own drift and go blind. So they are split into two independent channels. *Model-dependent signals* — **surprise** (accumulating, coherent prediction error, distinguished from bad luck by its breadth across a cohort) and **calibration drift** (resolved confidences no longer matching outcomes) — are informative but only as trustworthy as the predictions and the (censored) outcomes behind them. *Model-independent signals* — **staleness** (elapsed time since fresh observation, which owes nothing to the model's own predictions), **direct low-inference contradiction** (a trace at the bottom of the inferential gradient that a belief cannot survive), and **operator correction / override** (the human contradicting or overruling the mind, Constitution VII.2) — do not depend on the model being right, and are therefore the backstop that catches a model its own surprise no longer can. When any fires, the correct response is to widen uncertainty and, where it matters, to **announce the change and revise** — a trust-building act, not a failure. (Theory §3.21, Law 11; Constitution III.6, VII.2, VIII.)
- **Honesty under censored outcomes.** Because most predictions never cleanly resolve, the self-model is built from the resolved minority *without mistaking it for the whole*: unresolved cases are neither discarded (survivorship bias) nor imputed an outcome (fabrication). Where the record has stayed silent, uncertainty widens rather than reading silence as confirmation. (Theory §3.27, Law 15; Constitution XI.1.)

*Implements:* Constitution III.2, III.6, VII.2, VIII, XI.1, XI.7; Theory §3.11, §3.12, §3.18, §3.21, §3.23, §3.27, Laws 10, 11, 15.

### H. From understanding to priorities (executive reasoning)

Executive reasoning is the **portfolio-level reasoning lens** — one of the four lenses (below), not the scheduler. The scheduler is the attention controller of Part D, which *admits* items and *selects* the lens; executive reasoning is what the mind *does* when the portfolio lens is selected. Kept distinct, the controller decides *what earns cognition*, and this faculty decides, among what was admitted, *where attention changes outcomes the most* — the **portfolio triage** the controller deliberately does not perform. It is comparative allocation across relationships and the operator's channel, not depth on any one relationship. (Theory §3.19; Constitution VI.1.)

It thinks in **cohorts, causes, and consequences**, not counts: "new leads are down and it is entirely one source" is executive reasoning; "you have twelve new leads" is a readout. It searches for **leverage** — a point where a small intervention produces a large change in outcome — which is a causal-structural notion (Part I relies on it). Portfolio triage is the **economic judgment** proper: risk-adjusted return over value, cost, and time against the operator's goals — the comparative allocation the salience layer (Part D) deliberately defers to here. (Theory §3.19, §3.24, §3.26, Law 16.)

The Constitution's **four intelligences are lenses the controller selects, not modules**: *executive* (how is the business, where should attention go), *sales* (how to win this specific deal — the real objection vs. the stated one), *relationship* (who is this human, where are we in our story — continuity and emotional trajectory), *operational* (what is falling through the cracks). One mind holds all four; the attention controller (Part D) selects which a situation demands and admits it, and the selected lens then does the reasoning. Executive is one lens among the four — the portfolio lens — never the parent of the other three. (Constitution VI.)

*Implements:* Constitution VI, VI.1; Theory §3.19, §3.24, §3.26, Law 16.

### I. From priorities to candidate actions (planning)

Once a relationship earns attention and a lens is chosen, the mind reasons toward **action** — its only means of advancing goals. Two Theory primitives govern this.

**Causal effect.** An action is chosen for the change it would *cause* in latent state, and a cause is a **difference-maker** (had the action been different, the outcome would have been different), not a co-occurrence. The mind holds confounding as a live alternative rather than leaping to the convenient story, and where causation cannot be established it says so instead of dressing correlation as explanation. Both diagnosis ("why did this stall?") and the value of an action ("what will this change?") are counterfactual. (Theory §3.24, §3.20, Law 13.)

**Planning is a faculty, invoked — not the centre.** A relationship is advanced by a *campaign*, not an isolated reaction: a multi-step sequence toward the **next commitment**, with contingencies ("if they raise price, then..."). Plans are **hypotheses about the future**, held with confidence and revised as the world responds; a plan clung to after the world contradicts it is a failure mode, not planning. A plan spends the operator's attention over time, so its cost is part of its evaluation. Single-step choice is not planning, and not every situation needs a plan — the faculty is invoked when the relationship's next step is genuinely multi-move. (Theory §3.16, §3.23, §3.26.)

Every candidate action is individuated by its causal effect **and its reversibility** — the property that decides who is allowed to take it (Part J). Some actions are **informational**: taken to *learn* — to resolve epistemic uncertainty or produce an observable outcome under censoring — and their value includes the value of the information they yield, but they too must be reversible and within the operator's goals. (Theory §3.25, §3.27.)

*Implements:* Constitution X; Theory §3.16, §3.20, §3.23, §3.24, §3.25, §3.26, §3.27, Law 13.

### J. The action gate (reversibility, and the four choices)

Every deliberation resolves into **exactly one** of four outputs. Two gates, applied in order, determine which.

**Gate 1 — Reversibility (the permanent authority boundary).** The mind first classifies the contemplated action as reversible or irreversible. Reversibility is a property of the *action*, not of the confidence behind it. If the action would **send, commit, publish, or destroy** in a way that cannot be cleanly undone, the mind may only **recommend** — it drafts and awaits an explicit human hand — *regardless of certainty*. Autonomy expands without limit only **inside** the reversible domain; the irreversible line never moves. The mind owns the thinking; the human owns the wanting and the irreversible doing. (Constitution VII.3, XI.2; Theory §3.25, Law 12.)

**Gate 2 — Value (speak, or stay silent).** Having something true and sufficiently certain is *not* grounds to say it. The output must clear the **interruption bar** and the **taste test**: *would the best sales manager this human has ever worked with have surfaced this, now, in this tone?* Spending the operator's scarce attention badly is one of the gravest failures. (Constitution III.4, XIII; Theory §3.13.)

The four terminal choices:

- **Act** — reversible, within earned autonomy (the represented belief of Part K), and clears the value bar: prepare, draft, organise, surface, provisionally arrange.
- **Recommend** — irreversible (or reversible but beyond earned autonomy, read from Part K): draft and await human authorisation.
- **Ask** — the missing input is one *only the human holds* (an intent, a value, a goal, a genuine tradeoff between the operator's own competing goals), or observation is exhausted with high stakes and an irreversible action looming. The mind must never ask the human to do the mind's own job of perception or prioritisation: "what are you trying to achieve this quarter?" is legitimate; "which leads should I check?" is forbidden. (Constitution VII.1, VII.2, XI.6; Theory §3.15.)
- **Stay silent** — nothing clears the bar. Silence is a first-class output, not the absence of one; a true, correct, unhelpful remark is noise, and noise destroys trust.

**The one override.** A genuinely dropped critical item — a hot lead going cold unseen, a promise about to be broken — must be surfaced even if it would otherwise fail the interruption bar. Operational vigilance outranks restraint; this is the single case where the mind is *required* to interrupt. But the override is disciplined by calibration to avoid **alarmism** (crying wolf devalues the channel): only genuinely critical, tractable items qualify. (Constitution XI.4, XI.5; Theory Part 5 — attention failures, alarmism.)

*Implements:* Constitution III.4, VII.1, VII.2, VII.3, XI.2, XI.4, XI.5, XI.6, XIII; Theory §3.13, §3.15, §3.25, Law 12.

### K. Other minds, throughout

Theory of mind is not a stage; it is woven through comprehension (E), executive reasoning (H), and planning (I). Business is intrinsically about other minds: reading "the real objection versus the stated one" *is* an inference about the counterpart's hidden beliefs and goals, and anticipating whether a lead will buy is simulating another agent's decision. The mind models two minds explicitly:

- **The counterpart** (lead or customer) — with their own beliefs, goals, and decision process, known only by inference and always the **most uncertain part of the model**, carrying the largest uncertainty and the highest inferential distance.
- **The operator** — their goals, risk tolerance, interruption threshold, which advice they take and how it turns out — because serving a human well requires understanding *this particular* human, scoped to that operator and role. One belief in this model is first-class: **earned autonomy** — a graded, revisable belief held *per operator and per class of action* about how much reversible latitude the mind has earned. Like any belief it updates from evidence: successful reversible actions and accepted recommendations widen it; overrides, corrections, and poor outcomes narrow it (Constitution VIII.5, trust granted in widening circles). It is precisely what the action gate (Part J) reads to decide, *within* the reversible domain, whether to **act** or merely **recommend**; without it, "within earned autonomy" would be an appeal to a quantity the mind does not actually hold.

Both are modelled with humility: assuming the counterpart wants what we want, or that this operator is the generic default, is a characteristic failure (theory-of-mind failure, Part 5). (Theory §3.17; Constitution VI.2, VI.3, VII.5.)

*Implements:* Constitution VI.2, VI.3, VII.5, VIII.5; Theory §3.17, §3.25, Law 9.

### L. Two regimes, and one contrast

**Two reasoning regimes** coexist and use the same substrate at different scales:

- **Executive (portfolio) regime** — reasons over a *set* of relationships: cohorts, sources, allocation, leverage, business health. It answers "where should attention go, and why are things the way they are." (Theory §3.19; Constitution VI.1.)
- **Single-relationship regime** — reasons over one dyad deeply: its latent state, trajectory, the real objection, the next commitment. This is where the sales, relationship, and operational lenses do their close work. (Theory §3.23; Constitution VI.2–VI.4.)

The executive regime *directs* the single-relationship regime by allocating attention to it; the single-relationship regime *feeds* the executive regime with the reconstructed states it aggregates. Neither is primary; they are the same mind at two scales of its multi-scale model (Part B).

**The contrast that defines the product:** business reasoning is **not** question-answering. Question-answering retrieves and stops, bounded by what was asked. Business reasoning is **causal** (asks *why*, not just *what*), **goal-relative** (the same fact yields different advice under different goals), **value-bearing** (weighs money, time, and relationship stakes by their real asymmetric cost), and **forward and committing** (anticipates the question behind the question and owns a recommendation under uncertainty rather than laundering the decision back to the human). A CRM that only answers questions forces the operator to already know what to ask; business reasoning surfaces what they did not know to ask — the entire reason to build this. (Theory §3.20; Constitution X.)

*Implements:* Constitution VI, X; Theory §3.19, §3.20, §3.23.

### M. The unified decision rules

All of the above converges into one disciplined choice, applied continuously, not only when asked. Given an attended situation:

1. **Do I understand enough?** (Part F) — Understanding is sufficient when the cheapest available new observation would not change the action, scaled by stakes. If **not** sufficient:
   - **Investigate further** when the resolving evidence is *observable by the mind itself*, is epistemic (not aleatoric), is cheap relative to its diagnostic value, and time permits — pursue the discriminating observation.
   - **Ask the operator** when the missing input is one *only the human holds* (intent, value, goal, or a genuine tradeoff between the operator's own goals), or when observation is exhausted at high stakes with an irreversible action looming.
2. **If sufficient — is the contemplated action reversible?** (Gate 1, Part J) — If irreversible (or beyond earned autonomy): **recommend** and await authorisation.
3. **If reversible — does it clear the value bar and taste test?** (Gate 2, Part J) — If yes: **act** within earned autonomy. If no: **stay silent**.
4. **Vigilance override** — a genuinely dropped critical, tractable item is surfaced regardless of the value bar, disciplined by calibration against alarmism.

This single logic is built to resist the Theory's Part 5 failure modes by construction: sufficiency-before-action resists *premature conclusion*; calibrated confidence resists *overconfidence*; the value bar and salience resist *drowning*, *tunnelling*, and *alarmism*; the reversibility gate resists overreach; the inferential-distance discipline resists *fabrication*; decay and the self-model resist *stale beliefs* and *structural drift*; theory of mind resists *theory-of-mind failure*; and the substrate's continuity resists *loss of continuity*.

*Implements:* Constitution III.4, VII.1, VII.2, VII.3, IX, XI.4, XI.5, XI.6, XIII; Theory §3.7, §3.9, §3.13, §3.15, §3.25, Laws 6, 12; Part 5 (all).

---

## Part 3 — The architecture in one picture

```mermaid
flowchart TB
  subgraph substrate [Substrate: the resident world model]
    Rel["Relationships<br/>(latent state, trajectory, commitments,<br/>cadence, next step; narrative = never-forget floor)"]
    Portfolio["Portfolio<br/>(cohorts, sources, business health)"]
    Rel <--> Portfolio
  end

  subgraph control [Control: attention controller]
    PreAttentive["Tier 1 pre-attentive coverage:<br/>ALL live relationships (mandatory floor);<br/>coarse: cadence, deadlines, absence"]
    Salience["Tier 2 endogenous salience (admission):<br/>which earn deep cognition; selects lens"]
    PreAttentive --> Salience
  end

  subgraph reason [Reasoning style + faculty]
    Comprehend["Comprehend (hypothesis-driven):<br/>theory-laden perception,<br/>inferential distance, diagnosticity"]
    Understand["Understanding:<br/>predict + explain;<br/>decision-sufficient"]
    Plan["Planning (faculty, invoked):<br/>campaign to next commitment,<br/>causal effects, revisable"]
    Comprehend --> Understand --> Plan
  end

  subgraph gate [Gate: the four choices]
    Reversible{"Reversible?"}
    Value{"Clears value bar<br/>+ taste test?"}
    Act["Act (within earned autonomy)"]
    Recommend["Recommend + await authorization"]
    Ask["Ask the operator<br/>(intent / values / goals)"]
    Silent["Stay silent"]
    Reversible -->|"no"| Recommend
    Reversible -->|"yes"| Value
    Value -->|"yes"| Act
    Value -->|"no"| Silent
  end

  Triggers["Triggers: new trace /<br/>time passing / self-model flag"] --> PreAttentive
  Question(["Human question"]) -. reads .-> substrate
  Salience --> Exec["Executive reasoning (portfolio lens):<br/>comparative triage across admitted set,<br/>cohorts, causes, leverage"]
  Exec --> Comprehend
  substrate -. beliefs + memory + priors .-> Comprehend
  Understand -. writes beliefs .-> substrate
  Plan --> Reversible
  Sufficient{"Understand enough?<br/>(decision stable, stakes-scaled)"}
  Understand --> Sufficient
  Sufficient -->|"no, mind can observe"| Comprehend
  Sufficient -->|"no, only human holds it"| Ask
  Sufficient -->|"yes"| Plan

  ToM["Theory of mind:<br/>counterpart + operator"] --> Comprehend
  ToM --> Exec
  Meta["Metacognition + self-model:<br/>model-dependent (surprise, calibration) +<br/>model-independent (staleness, contradiction, override);<br/>learning + forgetting; censored outcomes"]
  Outcomes["Outcomes<br/>(often censored / delayed)"] --> Meta
  Act --> Outcomes
  Recommend --> Outcomes
  Meta -. revise / restructure / recalibrate .-> substrate
  DroppedBall["Dropped critical item"] -.->|"vigilance override"| Recommend
```

The claims of the picture: the world model is the centre of gravity and is only occasionally *read* by a question; the attention *controller* (a mandatory pre-attentive coverage floor over every live relationship, then endogenous salience) decides what earns cognition, while the separate portfolio lens does comparative triage; comprehension is hypothesis-driven and theory-laden (no pure-observation stage); planning is a faculty invoked for campaigns; every output passes the reversibility gate against a represented earned-autonomy belief; theory of mind and memory feed the reasoning throughout; and metacognition sits above the cycle with both model-dependent and model-independent checks, keeping the model honest under censored outcomes.

*Implements:* the whole document; Constitution XII; Theory Part 8.

---

## Part 4 — Conformance map

Every element traces to the supreme Constitution and the frozen Theory. If a row cannot be traced, this document has drifted and must be corrected — never the Constitution (Constitution Article 0.3), and never the frozen Theory (Theory §0.4).

| Cognitive element (this doc) | Constitution | Theory |
| --- | --- | --- |
| Architecture selected against alternatives (Part 0) | I.1, III.4, V, VI, VII.1, XII | §3.10, §3.13, §3.19, §3.23, Laws 6, 16 |
| Cognitive environment / constraints (Part 1) | II, IV.1, VII.2, VII.5, VIII, IX, XI | Part 2, §3.2, §3.3, §3.12, §3.13, §3.22, §3.23, §3.26, §3.27, Laws 3, 6, 10, 14, 15 |
| Coverage floor vs variable depth; standards never bent (Part 1.12) | VI.4, VIII, IX, XI, XI.4 | §3.1, §3.8, §3.13 |
| Cycle not pipeline; theory-laden perception (A) | I.1, XII | §3.4, §3.10 |
| Resident, multi-scale, temporal world model (B) | I.1, V, VI.1, VIII.2, XI.8, XII | §3.6, §3.10, §3.22, §3.23 |
| Endogenous triggers; question is a read (C) | I.1, III.1, XII | §3.4, §3.12, §3.21, §3.22, Law 11 |
| Pre-attentive coverage floor; endogenous salience (admission); two economies (D) | III.4, VI.4, VII.1, XI.4 | §3.4, §3.13, §3.14, §3.22, Laws 6, 7 |
| Inferential distance; diagnosticity; calibrated belief (E) | IX, IX.5, XI.1, XI.3, VIII | §3.3–§3.8, Laws 2, 4, 5 |
| Competing hypotheses; predictive + decision tests (F) | II, V, IX, IX.3 | §3.5, §3.7, §3.9, Laws 2, 4 |
| Learning; forgetting with narrative floor; self-model with model-independent checks; censored outcomes (G) | III.2, III.6, VII.2, VIII, XI.1, XI.7 | §3.11, §3.12, §3.18, §3.21, §3.23, §3.27, Laws 10, 11, 15 |
| Executive reasoning as portfolio lens (not scheduler); triage; leverage (H) | VI, VI.1 | §3.19, §3.24, §3.26, Law 16 |
| Causal effect; planning as invoked faculty (I) | X | §3.16, §3.20, §3.23, §3.24, §3.25, §3.26, §3.27, Law 13 |
| Reversibility gate; four choices; vigilance override (J) | III.4, VII.1, VII.2, VII.3, XI.2, XI.4, XI.5, XI.6, XIII | §3.13, §3.15, §3.25, Law 12 |
| Theory of mind; operator model; earned-autonomy belief (K) | VI.2, VI.3, VII.5, VIII.5 | §3.17, §3.25, Law 9 |
| Two regimes; business reasoning vs Q&A (L) | VI, X | §3.19, §3.20, §3.23 |
| Unified decision rules; resists Part 5 failures (M) | III.4, VII.1–VII.3, IX, XI.4–XI.6, XIII | §3.7, §3.9, §3.13, §3.15, §3.25, Laws 6, 12, Part 5 |

---

## Part 5 — How v2 pre-empts the v1 review defects

The hostile review that broke v1 found defects that were, at root, undefined terms. The frozen Theory settled the definitions; v2 is built on them, so the defects cannot recur:

- **Pure observation vs. predictive perception** → v2 has no pure-observation stage; comprehension is theory-laden with a tracked inferential-distance gradient (Part E; Theory §3.4).
- **Records as ground truth** → observations are corrigible, source-weighted proxies across an observer gap (Part 1, Part E; Theory §3.2, §3.3).
- **Memory-as-priors vs. recognition** → memory is episodic + semantic + procedural (Part G; Theory §3.11).
- **Confirming-only evidence** → belief records evidence for *and against*; disconfirmation is first-class (Part E; Theory §3.5, §3.6).
- **First-order-only uncertainty** → epistemic/aleatoric and first/second order are represented (Part E; Theory §3.7).
- **A single goal** → goals are plural, partially ordered, some are constraints; conflicts escalate (Parts 1, H, J; Theory §3.15).
- **No planning** → planning is an explicit invoked faculty (Part I; Theory §3.16).
- **No endogenous attention** → attention is the control system with two economies (Parts C, D; Theory §3.13).
- **No theory of mind** → counterpart and operator are modelled throughout (Part K; Theory §3.17).
- **No self-knowledge / staleness** → the self-model watches surprise, calibration, and staleness under censored outcomes (Part G; Theory §3.21, §3.27, Law 11).

Additionally, v2 adds what even a corrected v1 lacked: **action and reversibility as first-class** (Parts I, J; Theory §3.25), **causation as difference-making** (Part I; Theory §3.24), **temporality as constitutive of state** (Part 1, Part B; Theory §3.22), **economic prioritisation** (Part D; Theory §3.26), and an explicit **architecture-selection rationale** (Part 0).

---

## Part 6 — Decision record

Append-only. This records how the current ratified cognition layer came to be. It does not alter the architecture above.

### DR-1 — Ratification of v2.1 (2026-07-13)

- **v2.0 underwent adversarial review.** The freshly authored v2.0 was reviewed from three hostile perspectives (Chief AI Scientist, Cognitive Scientist, Chief Systems Architect) whose objective was to break it.
- **Critical architectural inconsistencies were identified.** Four Criticals: calibration mandated where outcomes are structurally censored (AIS-1); the self-correction loop depending only on signals a drifted model itself produces (AIS-2); the attention-first bootstrap paradox — needing deep cognition to decide where to spend deep cognition (COG-1); and the never-drop guarantee colliding with resource-bendable breadth (SYS-1). Four targeted Majors were also identified: executive scheduling conflated with executive reasoning (SYS-2); salience detection overlapping portfolio triage (SYS-3); earned autonomy used but never represented (SYS-4); and forgetting conflicting with narrative continuity (COG-3).
- **v2.1 resolved all Critical issues and the targeted Major issues.** One focused revision introduced a two-tier attention controller (pre-attentive coverage floor + endogenous salience), separated the mandatory coverage floor from variable reasoning depth, distinguished earned-calibratable from structurally-uncalibratable confidence, added model-independent self-correction channels, separated the attention controller (scheduling) from executive reasoning (a portfolio lens), separated salience-admission from portfolio triage, represented earned autonomy as a first-class belief, and protected the relationship narrative from forgetting. A second adversarial review confirmed **no Critical issue remained and none was introduced**, and recommended ratification.
- **Remaining observations are intentionally deferred as future refinements** — not blockers. Chief among them: restating the vigilance override's discipline as low-inference-grounded rather than calibration-grounded (SYS-5); tightening the sufficiency test's wording under censoring (SYS-6); and the domain-specific theories (organizational cognition, reference classes, business economics, operator modeling) already deferred by the frozen Theory. These are candidates for a deliberate, versioned future revision, per the Mutability note.

---

## Closing thesis

The commodity CRM copilot answers questions about data. This architecture describes the opposite kind of mind: a **resident world model** of every relationship and of the business, kept live by a continuous loop, its scarce attention spent like the resource it is, its beliefs graded and calibrated, its outcomes honestly reckoned even when the world never tells it how things turned out — so that when the human finally asks, the mind is not computing an answer but reporting a conclusion it already reached, with the evidence, the confidence, and the reason it might be wrong.

Its intelligence is not horsepower. It is the discipline of the chosen architecture: a world model at the centre because the Constitution says the unit of intelligence is a standing belief about reality; attention as the control because the Theory says a bounded mind must choose what to ignore; hypotheses and calibration because certainty is a promise about frequency, not a feeling; planning only when a relationship needs a campaign; and never — under any confidence, cost, or pressure — crossing the irreversible line alone. A mind built this way feels intelligent not because it talks well, but because it is usually right, openly unsure when it should be, and never silent when something is falling through the cracks.
