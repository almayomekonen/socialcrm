# Customer Automation — Compatibility Bridge Audit

**Status:** living register. Companion to
[`catalog-adoption-strategy.md`](./catalog-adoption-strategy.md) (which says
*how* the running system reaches the frozen architecture) and
[`customer-automation-builder-final.md`](./customer-automation-builder-final.md)
(which says *what* that architecture is).

**Why this document exists.** Every bridge is a small lie the system tells
itself so that two eras can coexist. Individually each is defensible;
collectively, undocumented, they become the architecture. This register makes
every one of them countable, owned, and scheduled — so a bridge can never
quietly become permanent by nobody remembering it was temporary.

**Rule of the register:** a bridge that is not in this table does not exist. If
you add one, add its row in the same commit, with an owner and a removal phase
or an explicit PERMANENT verdict and a reason.

**Audited at:** end of B6b (Complete Action Independence).

**Extending a permanent bridge is not adding one.** B6 added
`snapshotFieldsForEvent()` to `engineBridge.ts` — the mapping from the persisted
ADR-010 event contract (`leadSource`, `newStatus`) to catalog field keys
(`source`, `newStatus`). That is vocabulary translation between the catalog and
the engine's persisted shape, which is exactly what `engineBridge.ts` is and
always will be. Putting it anywhere else would have created a second, unowned
bridge; putting it there kept the count at one.

---

## 0. Summary

| | B5 | B6 | B7 | **B6b** |
| --- | --- | --- | --- | --- |
| Permanent by decision | 4 | 4 | 4 | **5** |
| Temporary, scheduled | 5 | 3 | 3 | **2** |
| Temporary, not schedulable | 1 | 0 | 0 | **0** |
| **Total live** | **10** | **7** | **7** | **7** |
| Deleted this phase | 2 | 5 | 0 | **2** |

**B6b deleted two and reclassified one.** §3.5 (the `sendTest` bypass) and §3.4
(email-driven variable validation) are gone. §3.6 (conformance pins) is
reclassified **permanent** — see §2.5: the pins are no longer scaffolding
waiting for a surface to be consumed; they are the mechanism keeping two
deliberately-separate sources of truth honest, and that job never ends.

Two remain, both owned by the SAME external dependency — the Builder writing
`actions[].parameters` instead of a `content` document — and B6b was explicitly
forbidden from changing Builder behaviour. They are §3.2 and §3.3.

**B7 deleted none and added none.** It was a proof phase, not a cleanup phase:
its job was to demonstrate that a new integration needs no new bridge, and the
count staying flat is that demonstration. The three scheduled bridges (§3.2,
§3.3, §3.4/§3.5, §3.6) are all owned by **B6b**, which is now the next phase.

One item deserves naming because it *looks* like a new bridge and is not:
`snapshotFieldsForEvent()` gained `...(event.fields ?? {})`, merging a
connector's catalog-keyed fields over the two legacy spellings. That is the
existing permanent bridge (§2.1) doing exactly its declared job — translating
between the persisted ADR-010 event shape and catalog vocabulary — for one more
event. No second mapping was created.

B6 deleted five: the condition→column projection in both directions,
`sourceFilterMatches`, the hardcoded premise-expiry comparison, and the
read-time conditions synthesis that existed only to feed them. §3.1 — the one
bridge the B5 audit could not schedule — is gone entirely, so the
"not schedulable" row is now empty.

---

## 1. Deleted in B6

### 1.0 The legacy condition projection *(DELETED — both directions)*

**Was:** `projectToLegacyColumns()` and `liftFromLegacyColumns()`
(`lib/automations/conditions.ts`), plus the `normalise()` half that called the
latter, plus every write of `targetStatus` / `sourceFilter` in
`db/automations/definitions.ts`.

**Why it existed.** B3 gave the Builder a general condition model while the
engine still narrowed on two dedicated columns. The projection kept them in
lockstep so B3 could ship without touching engine behaviour.

**Why it could go now.** `lib/automations/conditionEvaluator.ts` evaluates
`field · operator · value` for any event from catalog metadata alone. The two
columns have no reader left, so they have no writer either. They are no longer
even SELECTed — `COLUMNS` and `AutomationDefinition` dropped them.

**The columns themselves survive one release.** Nothing reads them, but the
B3/B6 backfills derived `conditions` FROM them, so keeping the source data
makes that backfill reversible against real production rows. Dropping them is a
follow-up cleanup once B6 is verified in production — deliberately not done in
the same phase that stops reading them.

### 1.1 `sourceFilterMatches()` *(DELETED)*

**Was:** `lib/automations/laws.ts` — prefix matching of a definition's
`sourceFilter` against the lead's namespaced source at emission.

**Replaced by:** a snapshot condition on the event's declared `source` field.
The equivalence is proven, not asserted: `conditionEvaluator.test.ts` keeps the
deleted implementation as an oracle and asserts the evaluator agrees with it for
every filter × every shape `clients.leadSource` can hold (`provider:id` or
null). `contains` is honest substring matching, which coincides with the old
prefix rule for every value the system can write.

### 1.2 The hardcoded premise-expiry comparison *(DELETED)*

**Was:** `universalGuards()` —
`f.event.trigger === 'status_changed' && f.lead.currentStatus !== f.expectedStatus`,
with `expectedStatus` read straight off the legacy column.

**Replaced by:** evaluation of whatever LIVE conditions the automation declares.
`SendFacts.expectedStatus` is gone; `SendFacts.premise` carries the event
definition, the conditions and their current values.

**The subtlety that made this safe.** B3 lifted `targetStatus` onto the
`newStatus` field — but `newStatus` is a *snapshot* ("the status it moved
into"), and the engine was never enforcing that. It compared against the lead's
**current** status at send time, which in catalog terms is a *live* condition on
`status`. So the accompanying migration rewrites the field key
`newStatus` → `status`, changing no operator and no value. It does not change
any automation's behaviour; it records the behaviour on the field whose
freshness actually produces it. Verified on a scratch Postgres: idempotent,
reversible, source conditions untouched.

---

## 1b. Deleted in B5

### 1.1 `decideSend()` — the email law adapter *(DELETED)*

**Was:** `lib/automations/laws.ts`

```ts
export function decideSend(f: SendFacts): LawDecision {
  const action = getAction('email.send')      // ← the engine naming its action
  if (!action) return skip('action_unavailable')
  return decideSendForAction(action, f)
}
```

**Why it existed.** B2 made the law pipeline compose from an action's declared
`laws`, but the worker still had no concept of "which action am I running" — it
only knew how to send email. `decideSend` was the seam: a generic pipeline
behind an email-shaped front door, so B2 could ship without touching the worker.

**Why it could go now.** B5 gave the worker action resolution. The worker asks
`decideSendForAction(action, facts)` where `action` comes from the definition,
so there is no longer an email-shaped entry point to preserve. Its one
production caller (`worker.ts:179`) is gone.

**How its behaviour is still proven.** The three test files that used it now
define a two-line local shim over `decideSendForAction(getAction('email.send'))`
and assert exactly what they asserted before. Every law assertion in
`laws.test.ts`, `lawPipeline.test.ts` and `catalogConformance.test.ts` passes
unchanged — which is the evidence that routing email through the generic path
changed no outcome.

### 1.2 The store's hardcoded action key *(DELETED)*

**Was:** `db/automations/definitions.ts`, three places —

```ts
action: 'send_email',                                          // createDefinition insert
actions: [{ actionKey: 'email.send', parameters: {...} }],     // createDefinition insert
actions: [{ actionKey: 'email.send', parameters: {...} }],     // updateDefinitionContent
```

plus a fourth in `normalise()`'s read-time synthesis.

**Why it existed.** Before the catalog there was one action, so the store wrote
its name directly.

**Why it could go now.** `createDefinition` takes an `actionKey` and derives the
engine column through the permanent bridge; `updateDefinitionContent` reads and
preserves the row's existing key (editing content never changes *which* action
runs); `normalise()` derives it from the `action` column through the same
bridge. The Builder and the actions layer choose the action via
`listActionsForEvent(event)[0]` — `requires` × `fields`, catalog-decided.

**Result:** the string `'email.send'` no longer appears in any engine, store or
Builder path. It appears in exactly two places: the catalog entry that defines
it, and the executor that implements it.

---

## 2. Permanent by decision

These are not scaffolding. They are how the system works, and scheduling them
for deletion would be a category error.

### 2.1 `engineBridge.ts` — catalog keys ↔ persisted vocabulary

- **What:** `lead.created` ↔ `lead_created`, `email.send` ↔ `send_email`.
- **Owner:** the engine's persisted vocabulary (ADR-008).
- **Why permanent:** `automation_jobs.trigger`, `automation_activity.trigger`
  and `automation_definitions.action` hold these values on live production rows
  under CHECK constraints. Renaming them migrates *meaning* over real data for
  zero user benefit — precisely what the engine ADRs forbid.
- **Can it be deleted?** No, and it should not be. It gained its first
  production callers in B5 (`normalise`, `createDefinition`, `actionKeyFor`),
  which is a strengthening, not a smell: the bridge is now the one place the
  two vocabularies meet at runtime, instead of literals scattered across the
  store.

### 2.2 The `laws` declaration on actions

Architecture (§3.8), not transition. An action declaring which laws it obeys is
the mechanism by which `task.create` can reach a suppressed lead while
`email.send` cannot.

### 2.3 Universal guards (`origin_import`, `lead_deleted`, `premise_expired`)

Deliberately **not** catalog-declared. They protect the engine's own integrity,
apply to every action that will ever exist, and must not be opt-out-able by
omitting a declaration.

### 2.4 `automation_activity.subject` carrying a generic summary

- **What:** `ExecutionOutcome.summary` is persisted in a column named `subject`.
- **Why permanent:** same reasoning as 2.1 — a live column with production
  rows. The *contract* is generic (`summary`); only the column name is
  email-era. The mapping is one line in the worker, documented at both ends.

### 2.5 Conformance pins — RECLASSIFIED PERMANENT IN B6b

- **What:** `catalogConformance.test.ts`, plus B6b's pin that the Builder's
  variable-chip constant equals `emailExecutor.resolvableFields`, plus the
  `engineBoundary.test.ts` exemption register.
- **Why it is no longer temporary:** the B5 audit filed these as scaffolding
  that dies "as each surface is consumed". That was right for the pins that
  guarded not-yet-consumed surfaces, and all of those are gone. What is left
  guards things that are deliberately, permanently separate: a client-safe
  constant and a server-only executor; a catalog entry and the engine's
  persisted vocabulary. Those pairs will never merge, so the pin holding them
  equal never expires.
- **Owner:** whoever changes either side.
- **Removal phase:** none. Deleting one would let the pair drift silently,
  which is the exact failure the pin exists to prevent.

---

## 3. Temporary — still alive, with a reason

### 3.1 Condition ↔ legacy column projection — **REMOVED IN B6**

This was the bridge the B5 audit could not schedule, and it is the reason B6
became the condition evaluator instead of the channel-law work. See §1.0–§1.2.
The row is kept here, struck through, so the register shows what was owed and
that it was paid rather than quietly dropped.

### 3.2 `content` → action parameters projection

- **What:** `actionParametersFromContent()` / `actionsForContent()`
  (`lib/automations/actionEntry.ts`). `content.{subject,body}` is the
  pre-catalog carrier for what are, in catalog terms, `email.send`'s two
  declared parameters.
- **Why it still exists:** the Builder authors `content`; the executor reads
  `actions[].parameters`. Until the Builder writes parameters directly, the two
  must never disagree.
- **Which phase removes it:** the Builder change that makes
  `actions[].parameters` the authored surface. **Not B6b** — B6b was explicitly
  forbidden from changing Builder behaviour, and this cannot be removed without
  doing so.
- **Can it already be deleted?** No.
- **What keeps it alive:** `AutomationSheet` still posts `subject`/`body` as
  top-level fields, and `sendTest` renders from them (§3.5).
- **B5 improvement:** it was four separate inline projections; it is now one
  function, used by `createDefinition`, `updateDefinitionContent` and
  `normalise` alike, so the invariant "parameters mirror content" has exactly
  one implementation and cannot drift.
- **Owner:** the Action Executor work.

### 3.3 `normalise()` read-time ACTIONS synthesis

- **What:** `db/automations/definitions.ts` — when a row's `actions` is empty,
  synthesise it from the `action` column and the content document. **The
  conditions half of this was deleted in B6** along with the projection it
  called; `conditions` is now simply authoritative.
- **Why it still exists:** the B3 migration backfilled both columns, but that
  migration **has not yet run in production** (this branch is unmerged). B5
  makes `actions` the source of truth for execution. Deleting the fallback in
  the same phase would violate the adoption rule — *no phase both switches a
  source of truth and verifies it for the first time*.
- **Which phase removes it:** the first phase AFTER the B3–B7 migrations are
  confirmed applied in production and a `SELECT count(*) … WHERE actions = '[]'`
  returns zero. **Not B6b** — this branch is still unmerged, so B6b could not
  have verified it without violating the adoption rule.
- **Can it already be deleted?** No.
- **What keeps it alive:** an unverified production migration.
- **B5 change:** `getDefinitionForWorker` now normalises like every other read,
  so the worker and the Builder see the same row. Its synthesised key comes from
  the bridge, not a literal.
- **Owner:** the migration rollout.

### 3.4 Closed email-variable validation — **REMOVED IN B6b**

`unknownTokens(content)` validated every action's content against a global
"email variables" constant. It is now `unknownTokensFor(resolvableFields,
content)`, and the field list comes from the **executor** — `emailExecutor`
declares `resolvableFields`, and an action with no executor resolves nothing
rather than inheriting email's vocabulary by accident.

The Builder's chip list stays a client-safe constant (importing an executor
into the Builder would drag a renderer into the browser bundle), and a
conformance test asserts the two are identical. That pin is §2.5, not a bridge:
it holds two intentionally-separate things equal rather than papering over an
era mismatch.

### 3.5 `sendTest` bypass — **REMOVED IN B6b**

`actions/automations/sendTest.ts` no longer resolves a sender identity, renders
an email or reaches a transport. It authorises the caller, finds the testable
action **in the catalog** rather than naming one, validates against that
action's vocabulary, and calls `executor.test(...)`. The frozen §3.9 contract
("`testable` + a generic `action.test(params, self)`") is now implemented, so
"שלח אליי בדיקה" works for any future channel with no change here.

The divergence risk the B5 audit named — a rendering change made in the
executor but not in `sendTest` — is structurally impossible now: there is one
implementation.

### 3.6 Conformance pins — **RECLASSIFIED PERMANENT IN B6b** (see §2.5)

The pins that guarded not-yet-consumed surfaces are gone with their surfaces.
What remains holds two deliberately-separate sources of truth equal, and never
expires. Moved to §2.5.

---

## 4. Verified clear

| Former bridge | Status |
| --- | --- |
| `builderBoundary.test.ts` legacy exemptions | **Empty since B3**, and the test forbids the list growing or going stale. |
| Builder integration literals (`sheetOptions.ts`) | **Gone in B3.** Direct grep of both Builder directories for integration names, option sources and provider fields returns nothing. |
| Per-integration option lookups | **Gone in B4.** One `enum_remote` renderer, provider-resolved. |
| Worker's hardcoded email path | **Gone in B5.** The worker names no action. |
| Worker knowledge of a transport, an identity or a renderer | **Gone in B6b.** `WorkerDeps` lost `send` and `replyTo`; executors resolve their own dependencies via `defaultDeps()`. `worker.ts` contains the words `email`, `phone`, `transport`, `sms` and `whatsapp` exactly zero times — CI-enforced by `engineBoundary.test.ts`. |
| Email-shaped law facts | **Gone in B6b.** `SendFacts.lead.{email,emailUndeliverable}` became a generic `recipients` map keyed by the subject field each `requires` entry resolved to. |
| `if (fieldKey === 'email')` in the worker's default wiring | **Gone in B6b.** Deliverability moved to `recipientBlocks.ts`, a lookup registry keyed by recipient kind. |
| Legacy condition columns in the execution path | **Gone in B6.** Emission and execution both evaluate from catalog metadata; the columns are no longer selected, written or read. |

---

## 5. Standing review question

Before any future phase ships, ask of every row above:

> *Is this bridge still load-bearing, or is it just still here?*

A bridge whose dependency has been removed and which nobody deleted is the
mechanism by which temporary becomes permanent. §1 of this document should grow
every phase.
