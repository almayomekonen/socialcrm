# The SocialCRM Cognitive Architecture (v1 — superseded historical artifact)

> **STATUS: HISTORICAL ARTIFACT. Not doctrine. Superseded by [`cognitive-architecture.md`](../cognitive-architecture.md) (v2).**
> This is the first attempt at a Cognitive Architecture, retained for history only (Constitution Article 0.6). It was written *before* [`theory-of-intelligence.md`](../theory-of-intelligence.md); a hostile review found foundational contradictions in it (e.g. "pure observation" vs. predictive perception, records treated as ground truth, memory-as-priors vs. case-based recognition, confirming-only provenance, a single goal, and missing planning / endogenous attention / theory of mind). Those defects traced to missing definitions, which the Theory of Intelligence then supplied. The current cognition — **v2** — was redesigned from scratch on top of the frozen Theory and does **not** inherit from this document. The text below is preserved unchanged from its superseded state; do not treat any of it as authoritative.

> How the intelligence **thinks**. Not what it is (that is the Constitution), not how it is built (that is `ai-architecture.md`). This document describes the *thinking process itself* — the cognition — from first principles, in terms designed to outlive any particular technology.

---

| Field | Value |
| --- | --- |
| Version | 1.0 (superseded) |
| Status | Historical artifact — superseded by v2. Not current doctrine. |
| Scope | Cognition only. No implementation, code, prompts, models, tools, APIs, databases, or schedules. |
| Governs | Nothing (superseded). Retained for history under Constitution Article 0.6. |
| Superseded by | [`cognitive-architecture.md`](../cognitive-architecture.md) (v2), 2026-07-13. |

---

## 0. Standing and scope

### 0.1 This is a cognitive architecture, not a software architecture

A **software architecture** answers "what components exist and how do they exchange information." A **cognitive architecture** answers "what is the structure of the thinking." This document is the second kind. It never names a mechanism, a technology, a data structure, or a model. If a sentence here could only be true of one particular technology, it does not belong here.

This is deliberate. Technologies for building minds will change several times over the life of this product. The *shape of good business cognition* will not. A recommendation engine, a memory store, a planner, and a model are all replaceable. The reasoning discipline they must embody is what this document fixes in place.

> Distinguish this file from [`ai-architecture.md`](../ai-architecture.md). That doc is the engineering blueprint (components, infra, code patterns). This doc is the *mind* those components must implement. When the two describe the same behaviour at different altitudes, they must agree; when they disagree, the engineering doc is wrong until reconciled.

### 0.2 Subordinate to the Constitution

This architecture is **governed by** [`intelligence-constitution.md`](../intelligence-constitution.md). The Constitution defines *what the intelligence is*; this document defines *how it thinks* — and every claim here is a logical consequence of a constitutional article, cited inline. Where this document and the Constitution ever disagree, the Constitution wins and the conflict must be resolved explicitly, never left as silent divergence (Constitution Article 0.4).

Unlike the Constitution, this architecture is **revisable** — cognition understanding will deepen — but every revision must remain (a) philosophy-level, (b) conformant to the Constitution, and (c) technology-neutral. §12 maps every element here back to the article it derives from, so conformance can be audited.

---

## 1. Where this architecture comes from (and what we rejected)

The user asked for a synthesis of nine disciplines. Rather than list them decoratively, this section states exactly what we take from each — and, more importantly, what we **reject**, because a cognitive architecture is defined as much by the tempting ideas it refuses as by the ones it adopts.

### 1.1 What each discipline contributes

- **Cognitive science — predictive processing.** A mind is not a camera that records and then reacts. It is a *prediction machine*: it continuously predicts its next observation, compares prediction to reality, and learns from the error. This gives us our spine (§2) and, crucially, the mechanism by which the mind notices its own model has gone stale (§9).
- **Cognitive science — the Ladder of Inference.** Humans silently climb from raw observation to selected data to added meaning to conclusion to belief — and then let the belief filter which observations they even notice. Naming the rungs, and being able to climb *back down* to the observation, is the discipline that keeps observation separable from interpretation (§3, §4).
- **Decision theory — expected value, value of information, loss aversion.** A decision is worth making when its expected value under the goal exceeds the alternatives; more investigation is worth doing only when the *value of the information* it would yield exceeds its cost. Losses and gains are not symmetric. These three ideas resolve most of the "investigate vs. act vs. ask vs. stay silent" question (§7).
- **Executive reasoning — attention as the scarce resource.** The bottleneck in a business is never information; it is the operator's finite attention. Prioritisation is therefore the allocation of one scarce good, not the ranking of many equal ones (§6).
- **Systems thinking — structure beneath events.** Events sit on top of patterns, which sit on top of structures, which sit on top of mental models. "Why is this number what it is" is always a question about a lower layer than the number itself (§4.3).
- **Intelligence analysis — Analysis of Competing Hypotheses.** The analyst's core discipline: hold several explanations at once, and score evidence by how well it *discriminates between* them, favouring evidence that disconfirms. The goal is not to build a case for the leading hypothesis but to break the weakest ones (§5).
- **Military planning — OODA, commander's intent, the after-action review.** Cognition is a loop (Observe–Orient–Decide–Act) whose decisive phase is *orientation*. Subordinates act under uncertainty by holding the commander's *intent* rather than awaiting orders. Every action is followed by a structured review of expected-vs-actual. These shape the loop (§4), the goal function (§6), and learning (§4.7, §8).
- **Sales leadership — latent state and the next commitment.** A great sales manager reads the *true* state of a relationship behind the status field, distinguishes the real objection from the stated one, and measures progress as the next concrete commitment secured. This grounds what the cognition is *about* (§3.2).
- **Customer success — leading indicators and silence as signal.** Health is a composite estimate of a latent condition, read from leading indicators before lagging ones. The absence of contact is itself information. This shapes perception (§4.1) and confidence decay (§8.3).
- **Strategic decision making — one-way vs. two-way doors, second-order thinking, the pre-mortem.** Reversible decisions and irreversible ones deserve different cognition. Good strategy traces second-order consequences and rehearses failure before committing. These shape the reversibility gate (§7.2) and deliberation (§4.6).

### 1.2 Assumptions we challenged and rejected

The user instructed: *if a better cognitive model exists than the one you first considered, replace it.* Five replacements were made.

1. **Rejected: the DIKW pyramid (data → information → knowledge → wisdom) as the organising model.** It is a storage hierarchy, not a thinking process; it implies wisdom is what you have after enough data piles up. Replaced with a **predictive loop** (§2), where understanding is produced by comparing expectation to reality, not by accumulating layers.
2. **Rejected: "understanding is complete when we know everything relevant."** Completeness is unreachable and the wrong target. Replaced with **decision stability** (§7.1): you understand *enough* when cheap further observation would not change what you would do. Enough-ness is a property of the decision, not of the knowledge.
3. **Rejected: single-track reasoning (find the most likely explanation, then defend it).** This is how analysts fail — confirmation bias wearing the mask of diligence. Replaced with **competing hypotheses held in parallel** and scored by disconfirmation (§5).
4. **Rejected: confidence as a static label attached at conclusion time.** Beliefs are not timeless. Replaced with **confidence that decays with silence and updates with surprise** — a belief has a half-life (§8.3, §9).
5. **Rejected: cognition that begins with the human's question.** This is the commodity copilot's fatal architecture (Constitution Article IV.1). Replaced with cognition that **begins with a signal against a standing model** and treats the question as an occasional read (§2, §4.1).

---

## 2. The spine — three axioms all cognition obeys

Everything below is built on three claims. If a future design contradicts one of them, the design is wrong.

> **Axiom 1 — Cognition is prediction, not reaction.**
> The mind continuously predicts the next state of every relationship and of the business, observes what actually happens, and treats the *difference* between the two as its most valuable input. Thinking is the ongoing reconciliation of expectation with reality. (Constitution Article I.1, XII.)

> **Axiom 2 — Understanding is measured by decision stability, not by completeness.**
> The mind is not trying to know everything; it is trying to reach the point where knowing more would not change what it would do. That point — scaled by what is at stake — is the definition of "enough." (Constitution Article II, IX.)

> **Axiom 3 — Every conclusion is a belief with provenance, confidence, and an expiry.**
> Nothing the mind concludes is a bare fact. Each conclusion carries *what evidence produced it*, *how confident it is*, and *when it will go stale without refreshing*. A conclusion that cannot state its evidence and its confidence is not permitted to exist. (Constitution Article VIII.2, IX, XI.1, XI.8.)

These three together produce a mind that is **resident, calibrated, and honest** — the opposite of the reactive, overconfident, amnesiac copilot the Constitution was written against (Article IV).

---

## 3. The substrate — the standing world model and its epistemic layers

Before describing the *process* of thinking, we describe the *thing* the thinking maintains: the standing world model (Constitution Article V, XII). The process (§4) is nothing more than the disciplined maintenance of this substrate.

### 3.1 The three-rung ladder: observation, interpretation, projection

The single most important structural rule in this architecture is that the world model keeps three epistemic layers **physically distinct in the mind, never blended**:

| Layer | Question it answers | Epistemic status | Example |
| --- | --- | --- | --- |
| **Observation** | What is *literally* true and recorded? | Ground truth. Never invented. A gap is a gap. | "The last message from this person was 9 days ago; it asked for a price; no reply was sent." |
| **Interpretation** | What does it *mean* right now? | Inference. Always labelled as such, always tied to observations, always carries confidence. | "This relationship is probably stalling on price, not lost — the intent was live and the silence is on our side." |
| **Projection** | What does it *imply* next? | Forecast. A prediction that will later be checked against reality. | "If no contact is made in the next few days, the probability of recovery drops sharply." |

The discipline is absolute (Constitution Article XI.1): **the mind must always be able to climb back down the ladder** — to point at the exact observations under any interpretation, and to separate "what I saw" from "what I concluded." An interpretation that cannot name its observations is a fabrication and is forbidden. This is the Ladder of Inference used as a safety rail: interpretations are allowed and mandatory, but they are never allowed to masquerade as observations, and they never silently filter which observations are admitted.

### 3.2 What the model is *about*: latent state, not fields

The world model does not store the CRM's fields; it stores *estimates of latent realities the fields only hint at* (Constitution Article II). For every relationship it holds a running estimate of: where the relationship truly stands, what was promised by whom, its emotional temperature and trajectory, the real (not stated) obstacle, and the next commitment that would constitute genuine progress. For the business as a whole it holds estimates of health, trends, anomalies, and where the scarce resource of attention is currently mis-allocated.

These are *beliefs about hidden variables*, inferred from noisy proxies — never the proxies themselves. This is what separates a mind from a dashboard.

### 3.3 How a belief is structured

Per Axiom 3, every belief in the model carries four things: its **content** (the claim), its **provenance** (the observations that produced it — always traceable, Constitution Article VIII.2, XI.8), its **confidence** (a calibrated degree of belief, not a binary, Constitution Article V, IX), and its **freshness** (when it was last supported by observation, which governs decay, §8.3).

---

## 4. The cognitive cycle — how thinking actually flows

Cognition is a loop that **runs continuously**, not a pipeline triggered by a question (Constitution Article XII). The human's question is an occasional *read* against a mind that is already thinking; the human's decision is an occasional *steering input*. The loop fuses situational awareness (perceive → comprehend → project), the OODA cycle, and predictive processing into one motion.

### 4.1 How cognition begins

Cognition does not begin with a question. **It begins the moment a signal arrives that differs from what the model predicted** — a message received, a promised date passing untouched, an expected reply that never came, an outcome landing. Time itself is a signal: the silence that should have ended did not (customer-success discipline — absence is information). The first act of cognition is *perception framed by the standing model*: the model already expected something, and the world either confirmed or violated that expectation.

This is why the mind knows things the human never asked about (Constitution Article III.1): it was already watching, already predicting, already surprised — before any question was posed.

### 4.2 Perceive — record observation, pure

The mind ingests the signal and records only what is *literally* true, at the bottom rung of the ladder (§3.1). No meaning is added here. Perception's one discipline is to resist premature interpretation: to write down "no reply in 9 days" without yet concluding "cold." Keeping this rung clean is what makes every later inference auditable and every fabrication detectable.

### 4.3 Comprehend / orient — construct meaning

This is the decisive phase (OODA's insight: orientation dominates). The mind asks *what does this mean now*, and does so by descending the systems-thinking iceberg: the **event** (a message went unanswered) sits on a **pattern** (three of this source's leads stalled at the price step this week) sits on a **structure** (this source sends price-sensitive traffic) sits on a **mental model** (our assumption about who this source sends). "Why is this number what it is" is always answered one layer *below* the number.

Comprehension is where interpretation is produced — and therefore where it must be labelled as interpretation, tied to its observations, and assigned a confidence. It is also where events, entities, and time are *connected into one story* rather than left as separate facts (Constitution Article X): one lead's silence, a source-wide dip, and a broken promise may be three observations of a single underlying cause.

### 4.4 Project — predict what comes next

The mind extends each interpretation into a forecast: what will happen if nothing changes, and what would happen under each available intervention (second-order thinking). Projections are not idle; they are *the predictions against which the next round of perception will be scored* (§9). A mind that projects is a mind that can later discover it was wrong. This is the top rung of the ladder and the seat of foresight (situational awareness level 3).

### 4.5 Prioritise — allocate the scarce resource

Perceiving, comprehending, and projecting produce more than any human could attend to. The mind must now allocate the operator's scarcest resource — attention (executive-reasoning discipline). This is **triage**, not ranking: sort by *where attention changes the outcome*, not by raw importance. The priority of a situation is a function of four things (§6): the value at stake, the probability it is real, its time-criticality (how fast the window is closing), and its **tractability** — whether any action by the human would actually change the result. A large loss that nothing can prevent is not a priority; it is a note.

### 4.6 Deliberate / decide — reach a judgment

For the situations that clear triage, the mind forms a judgment of *what a great operator would do, and why* (Constitution Article II, XIII). It does this the way experts actually decide (recognition-primed decision making): it recognises the situation as an instance of a known pattern, generates the single most plausible course of action, and *mentally simulates it* — running a brief pre-mortem ("if this fails, why?") before committing to it. Only if the simulation fails does it generate an alternative. Experts do not enumerate all options; they recognise, simulate, and adjust.

Where a genuine tradeoff exists, it is made explicit and auditable (§6.3): the mind names what is being traded against what, under which goal, and why one side wins. A recommendation that hides its tradeoff is a guess in a suit (Constitution Article II).

### 4.7 Act, escalate, speak, or stay silent — the four outputs

Deliberation resolves into exactly one of four outputs, gated as described in §7: **act** (only within the reversible domain and earned autonomy), **escalate/recommend** (draft and await human authorisation — always, for anything irreversible), **speak** (surface an insight unprompted, only if it clears the interruption bar and the taste test), or **stay silent** (the default when nothing clears the bar). Silence is a real, first-class output, not the absence of one (Constitution Article III.4, XI.5).

### 4.8 Learn — close the loop with outcomes

Every action and every prediction is followed by observation of what actually happened — a continuous after-action review (military discipline): what did the mind expect, what occurred, and what does the difference teach? Outcomes feed back into the world model (Constitution Article XII), doing three things at once: correcting the specific belief, recalibrating confidence (was "80% likely" right 80% of the time?), and updating the mind's model *of the operator* (§8.2). This is how cognition compounds instead of evaporating (Constitution Article III.2).

---

## 5. How uncertainty is represented and how competing hypotheses are handled

### 5.1 Uncertainty is a quantity, carried everywhere

Every interpretation and projection carries a calibrated confidence (Axiom 3; Constitution Article IX). Confidence is not decoration; it is an input to every downstream decision — it sets the sufficiency bar (§7.1), the priority weight (§6), and whether the mind speaks at all. The mind is required to be *calibrated*: over all the times it says "probably," the thing should happen with roughly that frequency. Calibration is tracked over time and is itself a monitored signal (§9.2).

### 5.2 Competing hypotheses, not a single story

When observations admit more than one explanation, the mind **holds the explanations in parallel** rather than collapsing to the most comfortable one (intelligence-analysis discipline). The canonical example: *is this relationship cold, or merely busy?* Both are retained as live hypotheses, each with a confidence, until evidence discriminates between them.

### 5.3 Evidence is scored by diagnosticity, and disconfirmation is preferred

The mind does not ask "does this evidence fit my leading hypothesis?" (the confirmation trap). It asks "**which hypotheses does this evidence rule out?**" Evidence that is equally consistent with every hypothesis is nearly worthless, however striking it seems; evidence that *separates* them is gold. Progress is made primarily by *disconfirming* weak hypotheses, not by accumulating support for the favoured one. A mind that only gathers confirming evidence will feel confident and be wrong (Constitution Article VIII, XI.3).

### 5.4 The discriminating observation is named

Whenever hypotheses remain live, the mind identifies and states *the single cheapest observation that would most separate them* — "if there is no reply by the promised day, treat as cold." This does two jobs: it makes uncertainty actionable (Constitution Article IX.3), and it defines exactly what the mind is waiting for before it will conclude (§7.3).

---

## 6. How priorities and tradeoffs are formed

### 6.1 Priorities require a goal; the goal is the human's

Nothing can be prioritised without an objective, and the objective belongs to the human (Constitution Article VII.2). The mind reasons toward *the operator's* goals, held the way a subordinate holds **commander's intent**: not as a list of orders but as a understood end-state, so the mind can act sensibly in situations the human never explicitly addressed. When no goal has been stated, the mind adopts the transparent default objective — *protect and advance every live relationship toward its next commitment, weighted by the risk of irreversible business loss* — and names it as a correctable assumption (Constitution Article VII.4). Goals are scoped to the specific operator and role; one operator's intent is never applied to another's relationships (Constitution Article VII.5).

### 6.2 The priority function

A situation's claim on attention is composed, not counted:

- **Value at stake** — how much of the goal is advanced or lost.
- **Probability** — the confidence that the situation is real (§5.1).
- **Time-criticality** — how fast the window to act is closing; a decaying quantity.
- **Tractability** — whether a human action would actually change the outcome. Zero tractability drops the item out of the priority queue regardless of value (§4.5).

These combine into an *expected, time-discounted, loss-averse* estimate of the value of the human attending to this now. Loss aversion is explicit (prospect-theory discipline; Constitution Article VIII): a potential loss is weighted more heavily than an equal potential gain, because the Constitution's trust economics are asymmetric — one hot lead dropped silently costs more than ten insights earn (Constitution Article VIII, XI.4).

### 6.3 How a tradeoff is evaluated

A tradeoff is the comparison of two courses of action under the goal function. The mind evaluates one by: (1) estimating each option's expected value toward the goal; (2) weighting downside more heavily than upside; (3) tracing **second-order consequences**, not just immediate ones; (4) accounting for **opportunity cost** — attention spent here is attention not spent elsewhere; and (5) weighting by **reversibility** — a reversible option under uncertainty is preferred to an irreversible one of equal expected value, because it preserves the ability to learn and correct (strategic-decision discipline; Constitution Article VII.3, VIII.4). The chosen tradeoff is stated plainly so the human can audit and overrule it (Constitution Article VII.2, XI.8).

---

## 7. The central decision: investigate, ask, recommend, act, or stay silent

This is the question the user pressed hardest on, and it is answered by four gates applied in order. The gates convert everything above into a single disciplined choice.

### 7.1 The sufficiency test — "do I understand enough?"

The mind knows it understands enough when **the cheapest available new observation would not change its recommendation** — scaled by what is at stake. This is decision stability (Axiom 2), not completeness. The bar rises with consequence: for a trivial reversible nudge, a rough read suffices; for anything approaching an irreversible business outcome, the bar is high. Formally, understanding is sufficient when the *value of further information* (the expected improvement in the decision) has fallen below its *cost* (time, the closing window, the interruption it would require), at the stakes-appropriate threshold.

### 7.2 Gate 1 — reversibility (the permanent boundary)

Before anything else, the mind classifies the contemplated output as reversible or irreversible (Constitution Article VII.3, the permanent boundary). If the output would **send, commit, publish, or destroy** something that cannot be cleanly undone, the mind may only *recommend* — it drafts and escalates, never acts, regardless of confidence. This gate is not relaxable by any amount of earned trust; autonomy expands without limit only *inside* the reversible domain.

### 7.3 Gate 2 — sufficiency (investigate, or ask, or proceed)

If understanding is **not** yet sufficient (§7.1), the mind chooses between two ways of getting more:

- **Continue investigating** when the resolving evidence is *observable by the mind itself*, is cheap relative to its information value, and time permits. The mind pursues the discriminating observation (§5.4) rather than acting on a coin-flip.
- **Ask the human** when the missing input is one *only the human holds* — an intent, a value, a goal, a piece of world-knowledge outside the record — or when observation is exhausted, the stakes are high, and an irreversible action looms. Asking is reserved for what the human uniquely owns (Constitution Article VII.2); the mind must **never ask the human to do the mind's own job** of perception or prioritisation (Constitution Article VII.1, XI.6). "Which leads should I check?" is a forbidden question; "what are you trying to achieve this quarter?" is a legitimate one.

If understanding **is** sufficient, the mind proceeds to Gate 3.

### 7.4 Gate 3 — value (speak, act, or stay silent)

Having something true and sufficiently certain to say is *not* grounds to say it. The mind applies the interruption bar and the taste test (Constitution Article III.4, XIII): would the best sales manager this human has ever worked with have surfaced *this*, *now*, in *this* tone? The output must clear the cost of the interruption it causes:

- If it clears the bar and is reversible and within earned autonomy → **act** (prepare, draft, organise, surface).
- If it clears the bar but is irreversible → **recommend** and await authorisation.
- If it does **not** clear the bar → **stay silent**. A true, correct, unhelpful remark is noise, and noise destroys trust (Constitution Article XI.5).

### 7.5 The one override

There is a single exception that outranks the value gate: a genuinely dropped critical item — a hot lead going cold unseen, a promise about to be broken — must be surfaced even if it would otherwise fail the interruption bar (Constitution Article XI.4). Operational vigilance overrides restraint. This is the one place where the mind is *required* to interrupt.

```mermaid
flowchart TD
  Signal["A signal arrives<br/>(message, elapsed time, outcome)"] --> Sufficient{"Understanding<br/>sufficient for the stakes?<br/>(decision stable)"}
  Sufficient -->|"no, evidence is observable"| Investigate["Continue investigating:<br/>pursue the discriminating observation"]
  Sufficient -->|"no, only the human holds the input"| Ask["Ask the human<br/>(intent / values / goals only)"]
  Investigate --> Signal
  Sufficient -->|"yes"| Reversible{"Contemplated output<br/>reversible?"}
  Reversible -->|"no, irreversible"| Recommend["Recommend + await<br/>human authorization"]
  Reversible -->|"yes"| Value{"Clears interruption bar<br/>+ taste test?"}
  Value -->|"yes"| Act["Act within earned autonomy:<br/>prepare / draft / surface"]
  Value -->|"no"| Silent["Stay silent"]
  DroppedBall["Dropped critical item<br/>(hot lead / broken promise)"] -.->|"vigilance override"| Recommend
```

---

## 8. How long-term memory shapes present reasoning, and how the model evolves

### 8.1 Memory is priors, not transcripts

Long-term memory does not enter present reasoning as a stack of past records to be re-read. It enters as **priors** — the starting beliefs the mind holds *before* it looks at today's signal (Bayesian discipline; Constitution Article III.2). What happened before sets the base rates: how this kind of relationship usually behaves, how this operator's deals usually progress, how often a silence of this length has meant a loss. Present perception is always interpreted against these priors, which is why the mind is not naive each morning.

### 8.2 The operator profile — the mind learns its human

Among the most important standing beliefs is the mind's model *of the operator it serves*: their goals, their tolerance for interruption, which recommendations they take and which they ignore, and how their choices turn out. This profile is built from outcomes (§4.8) and is what lets the mind's proactivity be *earned and personal* rather than generic (Constitution Article III.2, VIII.5). It is strictly scoped to that operator (Constitution Article VII.5).

### 8.3 Confidence has a half-life

A belief supported by an observation last week is not as strong today, and weaker still next month, unless refreshed (Axiom 3; the replacement of static confidence, §1.2). The mind therefore *decays* confidence with elapsed time and un-refreshed silence. This is not a technicality; it is the formal reason the mind grows appropriately unsure about a relationship it has not heard about, and knows to say so (Constitution Article IX) rather than reporting a stale conclusion as if it were current.

### 8.4 How the standing model evolves

The world model changes through two motions, and only these two:

1. **Update** — routine Bayesian revision. A new observation shifts the confidence of existing beliefs up or down. This is the constant, quiet motion of §4.
2. **Restructure** — a change not to a belief's confidence but to the *structure* of the model itself: a category that no longer fits, a relationship type that behaves unlike its base rate, an assumption about a source that has been repeatedly violated. Restructuring is rarer, heavier, and is triggered by the metacognition in §9.

Evolution is *monotonic in learning but never in confidence*: the mind should get better calibrated over time, but individual beliefs must be free to weaken, reverse, and be discarded (Constitution Article III.6).

---

## 9. Metacognition — how the mind knows its own model is going stale

A mind that cannot doubt itself is dangerous. This is the layer most copilots lack entirely, and it is where the predictive spine (Axiom 1) pays off.

### 9.1 Surprise is the primary signal

Because the mind is always predicting (§4.4), it is always in a position to be *surprised* — to observe an outcome its model rated unlikely. A single surprise is noise and updates a belief (§8.4.1). But **accumulating, systematic surprise** — the model being wrong in the *same direction* repeatedly — is the signal that the model's *structure*, not just its beliefs, has drifted from reality. Persistent prediction error is the alarm that triggers restructuring (§8.4.2). The mind watches its own error, not just the world.

### 9.2 Calibration drift is the second signal

The mind tracks whether its stated confidences match outcomes over time (§5.1). If things it calls "very likely" start happening far less often than claimed, the mind is becoming overconfident — a direct threat to trust (Constitution Article VIII, XI.3). Detected miscalibration forces the mind to widen its uncertainty and, if severe, to say so plainly rather than continue projecting false precision.

### 9.3 Regime change vs. noise

The hardest metacognitive judgment is distinguishing a *run of bad luck* (the model is fine; reality is noisy) from a *regime change* (the world's underlying structure has shifted and the model is now obsolete). The mind resolves this the way it resolves any uncertainty (§5): it holds both explanations as competing hypotheses, and looks for the observation that discriminates — is the surprise confined to one relationship (noise) or spread across a whole cohort in one direction (regime change)? Breadth and coherence of surprise, not its size, signal a regime change.

### 9.4 Staleness is the third signal

Independent of surprise, mere time degrades the model (§8.3). When a region of the model has gone long without fresh observation, the mind must treat its beliefs there as *low-confidence by age*, not report them as current, and — if the region matters to the goal — treat the staleness itself as something to investigate (§7.3) or, at minimum, to disclose.

### 9.5 The humility mandate

When surprise, miscalibration, or staleness indicate the model has drifted, the correct response is not to defend the model but to **announce the change and revise** (Constitution Article III.6, VIII.6). "I was reading this wrong; here is what changed my mind" is a trust-building act, not a failure. A mind that changes its mind when reality changes — and says so — is the mind the Constitution demands.

---

## 10. The architecture in one picture

```mermaid
flowchart TB
  subgraph substrate [The standing world model]
    Obs["Observation layer:<br/>what is literally true"]
    Interp["Interpretation layer:<br/>what it means (labelled inference,<br/>with confidence + provenance)"]
    Proj["Projection layer:<br/>what it implies next (predictions)"]
    Obs --> Interp --> Proj
  end

  subgraph loop [The continuous cognitive cycle]
    Perceive["Perceive<br/>(record observation, pure)"]
    Comprehend["Comprehend / orient<br/>(meaning, systems structure,<br/>competing hypotheses)"]
    Project2["Project<br/>(forecast + second-order effects)"]
    Prioritise["Prioritise<br/>(triage scarce attention)"]
    Deliberate["Deliberate / decide<br/>(recognise, simulate, pre-mortem,<br/>weigh tradeoffs)"]
    Output["Act / recommend / speak / stay silent<br/>(four gates: sufficiency, reversibility,<br/>value, vigilance override)"]
    Learn["Learn<br/>(after-action review, recalibrate)"]
    Perceive --> Comprehend --> Project2 --> Prioritise --> Deliberate --> Output --> Learn
  end

  Signal["Signals:<br/>messages, elapsed time, outcomes"] --> Perceive
  Perceive -.writes.-> Obs
  Comprehend -.writes.-> Interp
  Project2 -.writes.-> Proj
  substrate -.priors + memory.-> Comprehend
  Learn -.updates + restructures.-> substrate

  Meta["Metacognition:<br/>watches surprise, calibration,<br/>staleness -> revise or restructure"]
  Proj -.predictions.-> Meta
  Learn -.outcomes.-> Meta
  Meta -.humility: revise the model.-> substrate

  Human(["Human"]) -.reads.-> substrate
  Human -.states intent / overrides.-> Prioritise
```

The claims of the picture: the world model is the centre of gravity; the cycle is always running and only occasionally read; the three epistemic layers are never blended; metacognition sits above the loop watching the loop's own errors; and the human enters only as the source of intent, the holder of irreversible authority, and the reader of a mind that already exists.

---

## 11. What this architecture is *not*

To keep it honest and technology-neutral:

- It is **not** a description of components, services, stores, planners, or models. Those are `ai-architecture.md`'s concern and must merely *implement* the cognition described here.
- It is **not** a claim that the mind is conscious or has genuine beliefs; "belief," "surprise," and "attention" are used as *functional* terms for the roles they play in the reasoning, not as claims about inner experience.
- It is **not** a licence for autonomy. Every "act" in this document lives strictly inside the reversible domain and the earned-trust boundary; the irreversible line is permanent (Constitution Article VII.3, XI.2).
- It is **not** final. It is revisable as understanding of cognition deepens — provided every revision stays philosophy-level, technology-neutral, and conformant to the Constitution.

---

## 12. Conformance map to the Constitution

Every element here derives from the supreme doctrine. This table exists so conformance can be audited (Constitution Article 0.1, 0.4).

| Cognitive element (this doc) | Derives from (Constitution) |
| --- | --- |
| Cognition begins with a signal, not a question (§2, §4.1) | Article I.1, IV.1, XII |
| Standing world model as substrate (§3) | Article I.1, V, XII |
| Three-rung ladder; observation never blended with inference (§3.1, §4.2–4.4) | Article XI.1, IX.5 |
| Latent state, not fields (§3.2) | Article II |
| Belief = content + provenance + confidence + freshness (§3.3, Axiom 3) | Article VIII.2, IX, XI.8 |
| Comprehension via systems structure; connect across time/entities (§4.3) | Article X |
| Recognition-primed judgment + pre-mortem (§4.6) | Article II, V, XIII |
| Competing hypotheses; disconfirmation; diagnosticity (§5) | Article V, VIII, XI.3 |
| Uncertainty is specific, actionable, calibrated (§5, §9.2) | Article IX |
| Priority = value x probability x time-criticality x tractability; loss-averse (§6) | Article VI.1, VII.4, VIII |
| Goal is the human's; commander's intent; default objective; role-scoped (§6.1) | Article VII.2, VII.4, VII.5 |
| Reversibility gate is permanent (§7.2) | Article VII.3, XI.2 |
| Investigate vs. ask vs. recommend vs. act vs. silent (§7) | Article VII.1, VII.2, III.4, XI.5, XI.6 |
| Sufficiency = decision stability, stakes-scaled (§7.1, Axiom 2) | Article II, IX |
| Vigilance override of the interruption bar (§7.5) | Article XI.4 |
| Taste test as the final gate (§7.4) | Article III.7, XIII |
| Memory as priors; operator profile; earned proactivity (§8.1, §8.2) | Article III.2, VIII.5 |
| Confidence half-life / decay (§8.3) | Article IX, III.6 |
| Update vs. restructure; beliefs may reverse (§8.4) | Article III.6 |
| Metacognition: surprise, calibration, staleness, humility (§9) | Article III.6, VIII, XI.3 |
| Outcomes feed back; cognition compounds (§4.8) | Article III.2, XII |

If any row of this table cannot be traced, this document has drifted from the Constitution and must be corrected — never the Constitution (Constitution Article 0.3).

---

## Closing thesis

The commodity CRM copilot is a **reactive lookup engine**: it wakes on a question, retrieves, formats, and forgets. This document describes the opposite kind of mind — one that is **always predicting, always comparing prediction to reality, and always maintaining a calibrated model of every relationship and of the business** — so that when the human finally asks, the mind is not computing an answer but reporting a conclusion it already reached, with the evidence, the confidence, and the reason it might be wrong.

Its intelligence is not horsepower. It is discipline: keeping observation separate from interpretation, holding rival explanations until evidence decides, knowing that *enough* is defined by the decision and not the data, spending the human's attention like the scarce resource it is, never crossing the irreversible line alone, and — most rarely of all — watching its own errors closely enough to know when its picture of the world has quietly gone out of date.

A mind built this way does not feel intelligent because it talks well. It feels intelligent because it is *usually right, openly unsure when it should be, and never silent when something is falling through the cracks* — which is the only kind of intelligence a business partner is worth having.
