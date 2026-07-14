# Wave 1 — M0 Interface Specification (The Interface Freeze)

> The stable interface specification that every Wave 1 runtime component will implement. It is **technology-independent**: it defines logical shapes, objects, events, and boundaries — never storage, serialization, code, APIs, schemas, or tools. It **realizes** and **conforms to** the ratified, frozen [`ai-runtime-architecture.md`](../ai-runtime-architecture.md) (v1.1) and never modifies it or any upstream doctrine.

---

| Field       | Value                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact    | Wave 1, Milestone M0 deliverable — the interface freeze.                                                                                                                                                                                          |
| Status      | **Draft for review.** Wave 1 implementation (M1+) must not begin until this specification is reviewed and accepted.                                                                                                                               |
| Scope       | Interfaces only: canonical runtime contracts, foundational runtime objects, foundational runtime events, and runtime boundaries — for the five Wave 1 systems. No system implementation, no application code, no technology, no schemas, no APIs. |
| Governs     | The shared vocabulary every Wave 1 runtime component implements. Once accepted, these shapes are stable for the duration of Wave 1; a change requires a reviewed revision, never a silent edit.                                                   |
| Realizes    | [`ai-runtime-architecture.md`](../ai-runtime-architecture.md) v1.1 (ratified & frozen) — Parts 3, 3A, 4, 5, 7.                                                                                                                                    |
| Conforms to | [`intelligence-constitution.md`](../intelligence-constitution.md) (supreme), [`theory-of-intelligence.md`](../theory-of-intelligence.md) (frozen), [`cognitive-architecture.md`](../cognitive-architecture.md) (ratified).                        |
| Non-goals   | Choosing technology; defining storage/serialization; creating APIs, classes, or database schemas; implementing any runtime system; introducing new doctrine.                                                                                      |

---

## Part 0 — Reading rules

1. **Logical, not physical.** Every "carries" list below names the logical elements a shape must convey and the invariant each element enforces. It says nothing about how any element is typed, stored, serialized, or transported — those are downstream implementation choices.
2. **Reference, never redefine.** Each definition points to the runtime-architecture part it realizes and the Constitution / Theory clause it rests on. It does not restate what a cognitive capability _is_.
3. **Wave 1 only.** Shapes needed only by advanced reasoning (Reasoning, Planning, Memory, Context Assembly, the Metacognition learning functions) are named as **deferred** and are not defined here.
4. **Frozen for the wave.** Once accepted, the shapes in Parts 1-4 and the boundaries in Part 5 are the stable interface every Wave 1 system builds against.

---

## Part 1 — Canonical runtime contracts (the Wave 1 set)

Contracts are logical shapes that cross between systems. Realizes runtime architecture Part 4. Seven are frozen for Wave 1; the rest are named deferred at the end of this part.

### 1.1 Belief

- **Carries:**
  - _Content_ — the claim about the hidden world.
  - _Confidence_ — a graded credence (first-order), never binary.
  - _Groundedness_ — how well-supported the confidence is (second-order), including a status marker of **earned-calibratable** vs **structurally-uncalibratable**.
  - _Uncertainty kind_ — epistemic vs aleatoric.
  - _Evidence-for_ — a reference set of supporting observations (via provenance). May be empty only for an absence-derived belief.
  - _Evidence-against_ — a reference set of opposing observations. The container is **mandatory** and always present; it may be empty but may never be absent.
  - _Freshness_ — the as-of time the belief was last touched by observation.
  - _Provenance handle_ — a link to its provenance chain (1.3).
  - _Scope handle_ — the actor/role scope the belief belongs to (5.5).
- **Produced by:** Event Interpretation (writes). **Held by:** World Model Runtime. **Read by:** Tool/Action Runtime (for recommendations).
- **Invariants:** a claim that cannot state a confidence or carry a provenance handle **is not a belief and may not enter the model**; the evidence-against container always exists; confidence is graded.
- **Realizes:** Part 4 Belief + Uncertainty contracts; Constitution VIII.2, IX, XI.8; Theory Section 3.6, 3.7, 3.8.

### 1.2 Uncertainty (carried within Belief)

- **Carries:** first-order credence; second-order groundedness; the epistemic/aleatoric tag.
- **Invariant:** "confidently 60%" and "cluelessly 60%" must be distinguishable; only epistemic uncertainty is marked as investigable.
- **Realizes:** Part 4 Uncertainty contract; Theory Section 3.7, 3.8; Constitution IX.

### 1.3 Provenance and inferential-distance

- **Carries:**
  - _Trace references_ — the underlying traces the claim rests on.
  - _Inference path_ — the ordered steps from trace(s) to claim.
  - _Inferential-distance grade_ — position on the low-inference to high-inference gradient.
- **Produced by:** Event Interpretation (stamped at first touch); extended nowhere without recording the step. **Consumed by:** the egress groundedness seam (5.7), any read that surfaces a claim.
- **Invariants:** every belief walks back to at least one trace, **or** is explicitly marked as absence-derived; a high-inference claim is never presented as low-inference; a claim with a broken chain **cannot pass egress**.
- **Realizes:** Part 4 Provenance contract; Constitution XI.1, XI.8; Theory Section 3.4.

### 1.4 Signal

- **Carries:**
  - _Signal type_ — message, status change, system event, **elapsed-time**, or **absence**.
  - _Source_ — origin identity.
  - _Source reliability_ — the weight to apply before any belief moves.
  - _As-of time._
  - _Absence marker_ — present when the signal is a non-event (expected-but-did-not-happen), carrying the expectation it violates.
  - _Surprise_ — the gap between this signal and what the model expected (may be none).
  - _Scope handle._
- **Produced by:** the ingress interface (5.6). **Consumed by:** Event Interpretation.
- **Invariants:** elapsed-time and absence are **first-class** signal types, not afterthoughts; source reliability is required before a belief moves.
- **Realizes:** Part 4 Signal contract; Cognitive Architecture C, E; Theory Section 3.3.

### 1.5 Temporal

- **Carries:** as-of time; trajectory (direction/momentum, where applicable); freshness/decay stamp; staleness mark; a cadence reference (the relationship's normal tempo); deadline/window expectations.
- **Produced by / held with:** State Management and World Model Runtime; travels with state.
- **Invariants:** time is carried _with_ state, not derived after the fact; "overdue" and "the right moment" are judged against cadence, never a fixed clock.
- **Realizes:** Part 4 Temporal contract; Theory Section 3.22; Cognitive Architecture B.

### 1.6 Action-descriptor (minimal)

- **Carries:**
  - _Proposed effect_ — the causal claim about what the recommendation would change.
  - _Reversibility class_ — reversible vs irreversible, carried as an **advisory hint only**.
  - _Provenance handle_ — the beliefs and traces supporting the recommendation.
  - _Value note_ — a minimal statement of why it matters (full value/cost economics is Wave 2).
  - _Output kind_ — one of **recommend** or **stay silent** (the only two active terminal outputs in Wave 1).
  - _Scope handle._
- **Produced by:** the dropped-ball vigilance path. **Consumed by:** the Tool/Action Runtime gate and egress seam.
- **Invariants:** the reversibility field is advisory — the gate re-checks and is the **sole authority**; an irreversible effect is never auto-executed; every descriptor carries a provenance handle.
- **Realizes:** Part 4 Action-descriptor contract, Part 5 Boundary 4; Constitution VII.3, XI.2.

### 1.7 Earned-autonomy (stub)

- **Carries:** an _autonomy level_, fixed at **none** for Wave 1, with placeholder dimensions for per-operator and per-action-class grading.
- **Consumed by:** the gate.
- **Invariant:** while the level is none, the gate routes **everything** to recommend or stay-silent; the shape exists now so Wave 2 can grade autonomy without a retrofit.
- **Realizes:** Part 4 Earned-autonomy contract; Constitution VIII.5 (as a not-yet-granted default).

### Deferred contracts (named, not defined here)

- **Observation** — a signal bound to a live hypothesis; needs hypotheses (Reasoning), so Wave 2.
- **Prediction** — a committed expectation; needs reasoning to commit, so Wave 2.
- **Outcome** — resolution or censored marker of a prediction; its _shape is recorded_ via the outcome event (Part 4) so nothing is lost, but its _processing_ is Wave 2.
- **Calibration** — the confidence-to-frequency aggregate; needs predictions and outcomes over time, so Wave 2.
- **Plan** — a campaign; needs the Planning Runtime, so Wave 2.
- **Earned-autonomy (full, graded)** — Wave 2.

---

## Part 2 — Foundational runtime objects (logical)

Objects are the logical things the runtime holds and passes. Each is defined by identity, composition, lifecycle, invariants, and scope — never by storage.

### 2.1 Relationship object

- **Identity:** a stable relationship identity within a scope.
- **Composition:** counterpart reference; history/narrative; latent-state beliefs; trajectory; mutual commitments; cadence; next commitment.
- **Lifecycle:** created when a relationship becomes live; maintained resident; never silently dropped from coverage.
- **Invariants:** the primary cognitive object (Theory Section 3.23); its history belongs to the protected narrative floor (2.6); a relationship with no next commitment is flagged as drifting.

### 2.2 Portfolio aggregate

- **Identity:** a named cohort/source/segment rollup within a scope.
- **Composition:** a derived view over a set of relationship objects.
- **Invariants:** multi-scale over one substrate (Theory Section 3.10); an aggregate faithfully reflects its members.

### 2.3 Belief record

- **Composition:** an instance of the Belief contract (1.1) about a relationship or a portfolio aggregate.
- **Invariants:** graded; carries provenance and freshness; evidence-against container present.

### 2.4 Signal/trace record

- **Composition:** an instance of the Signal contract (1.4).
- **Invariants:** typed; source-weighted; timestamped; absence-capable.

### 2.5 Provenance chain

- **Composition:** an instance of the Provenance contract (1.3) linking a belief down to traces along the inferential-distance gradient.
- **Invariants:** walkable end to end; a break blocks egress.

### 2.6 Narrative-floor record

- **Composition:** the protected continuity of a relationship — history, promises, outcomes.
- **Lifecycle:** written continuously; **exempt from pruning and consolidation**.
- **Invariant:** the narrative is never lost, even under forgetting or degradation (Constitution XI.7).

### 2.7 Actor/scope descriptor

- **Composition:** operator identity + role.
- **Lifecycle:** attached to **every** read and write.
- **Invariant:** no operator's state crosses into another's (Constitution VII.5); cannot be retrofitted — present from the first write.

### 2.8 Freshness/decay stamp and staleness marker

- **Composition:** the as-of time a belief was last refreshed; the decayed confidence over un-refreshed time; a staleness mark once a threshold is crossed.
- **Invariant:** time alone moves confidence and raises staleness — no trace required.

---

## Part 3 — Foundational runtime events

Events are the signals and triggers that drive the loop. Each is defined by trigger, carried data (logical), producer, consumer(s), and invariant. Realizes runtime architecture Part 6 (data flow).

- **Inbound trace** — _Trigger:_ a message/status/system event is recorded. _Carries:_ a Signal (1.4). _Producer:_ ingress interface. _Consumer:_ Event Interpretation. _Invariant:_ enters the model only via Event Interpretation.
- **Elapsed-time tick** — _Trigger:_ the passage of time. _Carries:_ current time, applicable to all resident state. _Producer:_ the clock. _Consumer:_ State Management (decay/staleness), Event Interpretation (absence), Scheduler (cadence). _Invariant:_ time is a first-class input, not metadata.
- **Absence detected** — _Trigger:_ an expected event did not occur within a cadence/deadline. _Carries:_ a Signal with the absence marker and the violated expectation. _Producer:_ Event Interpretation. _Consumer:_ World Model (belief update), Scheduler. _Invariant:_ absence is an observation.
- **Belief updated** — _Trigger:_ a belief is written or revised. _Carries:_ a Belief (1.1) with provenance. _Producer:_ Event Interpretation. _Consumer:_ World Model Runtime. _Invariant:_ no write without provenance.
- **Surprise raised** — _Trigger:_ an observation conflicts with expectation. _Carries:_ the surprise magnitude and the beliefs involved. _Producer:_ Event Interpretation. _Consumer:_ recorded in Wave 1; processed by the Metacognition learning functions in Wave 2. _Invariant:_ recorded, never discarded.
- **Coverage-sweep tick** — _Trigger:_ the scheduler heartbeat. _Carries:_ the swept membership set. _Producer:_ Runtime Scheduler. _Consumer:_ Scheduler internal + staleness. _Invariant:_ every live relationship is a member on cadence; membership never shrinks under load.
- **Staleness flagged** — _Trigger:_ a region unobserved beyond threshold. _Carries:_ the stale region reference and elapsed time. _Producer:_ State Management / Scheduler. _Consumer:_ Scheduler (re-attention). _Invariant:_ fires on time alone.
- **Dropped-ball / vigilance** — _Trigger:_ an open commitment past deadline, or silence beyond cadence. _Carries:_ a minimal Action-descriptor (1.6) with output kind = recommend. _Producer:_ Scheduler (from Tier 1 low-inference signals). _Consumer:_ Tool/Action Runtime. _Invariant:_ fires without any reasoning present (F2).
- **Outcome observed** — _Trigger:_ a resolution arrives (delayed, often censored). _Carries:_ the resolution or an explicit censored/unresolved marker. _Producer:_ Tool/Action Runtime + Event Interpretation. _Consumer:_ recorded in Wave 1; learned from in Wave 2. _Invariant:_ an outcome is never imputed; censored stays censored.

---

## Part 4 — Runtime boundaries and seams (active in Wave 1)

Boundaries are lines with enforced checkpoints. Realizes runtime architecture Part 5 and Part 7. Below, each is marked with its Wave 1 activation.

### 4.1 The five boundaries

1. **Cognition <-> Runtime (fidelity)** — _Active._ This specification realizes cognition and adds nothing; the conformance pointers throughout are the checkpoint.
2. **Runtime <-> Implementation** — _Active as a line._ This document defines the logical contracts; implementation (later milestones and below) binds concrete forms and may not alter a shape or an observable behavior.
3. **Mind <-> Operator** — _Partially active._ Only **recommend** and **stay silent** cross toward the operator in Wave 1; **act** and **ask** are deferred. _Checkpoint:_ the Tool/Action Runtime gate.
4. **Mind <-> Outside world (the permanent irreversible line)** — _Active as a gate skeleton._ No irreversible crossing is possible in Wave 1. _Checkpoint:_ reversibility classification, the sole authority, in the Tool/Action Runtime.
5. **Operator <-> Operator (permission scoping)** — _Fully active from day one._ Goals, memory, and relationship ownership are scoped to actor and role and never cross. _Checkpoint:_ the scope descriptor (2.7) threaded through every read/write.

### 4.2 The seams (checkpoints every path must pass)

- **Ingress tagging seam** — no signal becomes a belief without source weighting, provenance, and an inferential-distance grade (in Event Interpretation).
- **Egress groundedness seam** — nothing is surfaced unless every claim in it walks back to traces (in the Tool/Action Runtime).
- **Reversibility classification seam** — the gate re-classifies reversibility itself and is the sole authority; the descriptor hint is advisory.
- **Scope seam** — every read/write carries the actor/scope descriptor and is isolated by it.

### 4.3 The interface surfaces that must exist before M1

- **World Model read/write surface** — a _question is a read_ against the resident model; an _event is a write_ to it. The model is never summoned into existence by either.
- **Ingress interface** — how a Signal (1.4) enters Event Interpretation.
- **Event Interpretation -> Scheduler trigger interface** — how belief updates, absence, and surprise trigger scheduling.
- **Scheduler -> Tool/Action dropped-ball interface** — how a vigilance event delivers a minimal Action-descriptor to the boundary.

---

## Part 5 — Cross-cutting interface invariants

Every Wave 1 component implements these, regardless of which system it is:

- **Residency.** The world model persists and stays live between activations; it is not summoned per question (Constitution I.1).
- **Non-fabrication, both ends.** No unobserved fact is asserted at ingress; no ungrounded claim is surfaced at egress (Constitution XI.1).
- **Provenance is mandatory.** No belief is written without a provenance handle; without it, egress can never verify groundedness.
- **Coverage as membership.** Every live relationship stays in the swept set on cadence; membership never shrinks under load (Constitution VI.4, XI.4).
- **Narrative floor is protected.** History, promises, and outcomes are never pruned or consolidated away (Constitution XI.7).
- **Scope isolation.** No operator's state crosses to another's (Constitution VII.5).
- **Time is an input.** Elapsed time and absence drive decay, staleness, and vigilance with no trace required.
- **The irreversible line is permanent.** No irreversible effect is taken autonomously; in Wave 1 no such crossing is even reachable (Constitution VII.3, XI.2).

---

## Part 6 — What M0 deliberately excludes

- **Runtime systems** — no system is implemented at M0; M1-M5 implement them against these interfaces.
- **Deferred contracts** — Observation, Prediction, Outcome (processing), Calibration, Plan, full Earned-autonomy.
- **Deferred systems** — Memory Runtime, Context Assembly, Reasoning Runtime, Planning Runtime, the Metacognition learning functions.
- **All technology** — storage, serialization, transport, indexing, frameworks, models, schemas, APIs, and interfaces-in-code are downstream of this document and out of scope.

---

## Part 7 — M0 exit check

M0 is complete when:

- [ ] Each of the seven Wave 1 contracts (1.1-1.7) is defined as a logical shape with carried elements, producer/consumer, and invariants.
- [ ] Each of the eight logical objects (2.1-2.8) is defined with identity, composition, lifecycle, invariants, and scope.
- [ ] Each of the nine foundational events (Part 3) is defined with trigger, carried data, producer, consumer(s), and invariant.
- [ ] The five boundaries and four seams (Part 4) are defined with their Wave 1 activation and checkpoint.
- [ ] Every shape referenced by a Wave 1 system exists in this document; nothing points to an undefined contract, object, or event.
- [ ] No technology, storage, serialization, schema, API, or code appears anywhere.
- [ ] Every definition traces to the frozen runtime architecture and to the Constitution / Theory; nothing modifies any doctrine.

When accepted at review, these interfaces are frozen for Wave 1 and M1 (State Management) may begin.
