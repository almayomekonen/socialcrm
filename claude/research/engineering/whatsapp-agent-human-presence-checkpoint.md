---
domain: engineering
status: shipped
last_updated: 2026-08-23
related: [engineering/whatsapp-agent-vs-ai-panel.md, engineering/socialcrm-agent-blueprint.md, claude/ai/care-charter.md, claude/architecture-rules.md, claude/do-not-touch.md]
---

# WhatsApp Agent — Human Presence Checkpoint

**Status:** Human Presence and the `closed`-state migration are COMPLETE and
FROZEN. This is a checkpoint of what shipped and what remains open — not a
proposal. Do not refactor either implementation off the back of this document.

**Scope of the audited change:** the Human Presence safety model, its server-side
send guard, and `migrations/20260823130000_conversation_ai_state_allow_closed.cjs`.

---

## 1. The invariant

> **The agent runs autonomously until the human נציג starts typing.**

Five properties, each enforced at a named place:

| Property | Enforced by |
| --- | --- |
| **Reading does not stop the agent** | Nothing on the read path writes presence. `InboxReadMarker` and `markConversationRead` are untouched; the heartbeat fires only from composer `onChange` |
| **Typing stops the current turn** | `useComposerTypingSignal` → `signalHumanTyping` → `recordHumanTyping`. First keystroke fires immediately (no debounce); later ones throttle to `HUMAN_TYPING_REFRESH_MS` (4s) |
| **Human send is permanent takeover** | `recordHumanTakeover` → `markHumanActiveByConversation`, called from `sendWhatsappReply` and `sendTemplateToLead` **before** the Graph call |
| **The final server-side guard is authoritative** | `assertAgentSendAllowed` — fresh DB read, no cached verdict, immediately before the Graph call |
| **A delayed generation cannot race** | The turn epoch (below) |

### The turn epoch — why a TTL alone is insufficient

The race this model exists to close:

```
customer message → agent starts generating → rep starts typing
→ agent finishes generating → agent attempts to send
```

By the time a slow generation returns, a 12-second TTL may already have lapsed,
so *"is anyone typing right now"* answers **no** and the stale reply goes out.

`humanTypingAt` is therefore compared against the **turn epoch = the job's
`createdAt`**. If any keystroke landed at or after the turn began, every send
belonging to that turn is refused — during generation, after it, from a queue, or
from a retry. The reply is **discarded, not deferred**.

Two consequences worth stating explicitly:

- **It is retry-proof.** The epoch is the job's `createdAt`, so it is stable
  across re-claims; a retry cannot launder a poisoned turn.
- **It is not permanent.** The next customer message creates a job with a later
  epoch, so an agent no longer being typed over answers it normally.

Both `humanTypingAt` and `job.createdAt` come from the **Postgres clock**, and
`readHumanPresence` returns `now()` alongside the values it is compared against.
Worker/database clock skew therefore cannot decide a send.

---

## 2. Send guard coverage

`assertAgentSendAllowed` (`lib/inbox/autoresponse/agentSendGuard.ts`) — one
function, one fresh read, fail-closed. Decision order:

```
1. aiState = 'human_active'      → human_active            (permanent)
2. aiState = 'opted_out'         → opted_out
3. humanTypingAt >= turnEpoch    → human_typing_this_turn   ← the race guard
4. humanTypingUntil > now        → human_typing             (live TTL)
5. otherwise                     → authorized
   presence read threw           → presence_unavailable     (FAILS CLOSED)
```

**Complete inventory of autonomous WhatsApp sends — two enforcement points:**

| Enforcement point | Covers |
| --- | --- |
| `ireSend.ts` → `sendIreOutbound` | qualify turns, conversation closer, immediate handoff (`immediateHandoff.ts`), post-handoff (`postHandoff.ts`), no-response warning + close (`processNoResponseJob.ts`) |
| `worker.ts` (explicit call) | acknowledge-mode first contact, which does not route through `sendIreOutbound` |

There is no third path. `__tests__/inbox/humanPresence/guardCoverage.test.ts`
fails the build if one appears, if a guarded file loses its guard, if a send is
ordered before the guard, or if the guard is changed to accept caller-supplied
facts instead of reading them itself.

**Cheap pre-gate (not the guarantee).** `decidePreGeneration` also takes
`humanTyping`, computed by `humanTypingBlocksTurn(presence, job.createdAt)`, so a
turn a human already owns is skipped *before* an AI call is spent. Deliberately
returns `false` for takeover and opt-out — those stop the turn through their own
branches, with their own reasons and their own state writes.

---

## 3. Cancellation behaviour

`humanPresenceWatch.ts` polls presence every `HUMAN_PRESENCE_POLL_MS` (1.5s) while
the model runs and aborts the provider call via an `abortSignal` threaded through
`generateQualifyTurn` → `runStructured` → `generateObject`.

**It is an optimisation, not the guarantee.** If the whole module were deleted,
nothing would reach a customer that does not today — it would just be generated
wastefully first. Design properties:

- A **failed presence read never aborts** on its own. The outbound guard fails
  closed for us and is the authority; killing a generation because the database
  hiccupped would waste real turns.
- A cancelled generation skips as `human_typing`, deliberately **not** as
  `ai_unavailable` — treating it as a provider outage would burn the job's
  retries and eventually deliver the reply the human displaced.
- If the model **wins the race** with the abort, the reply is discarded at the
  boundary. Both outcomes are covered by tests.
- The watch **self-terminates** after 120s and every worker exit path stops it, so
  it cannot outlive its turn.

---

## 4. `conversation_ai_state` lifecycle

Seven states. `closed` is now persistable (§5).

| State | Written by | Semantics |
| --- | --- | --- |
| `new` | row default | never touched by the agent |
| `ai_qualifying` | `recordTurn` | agent is working the conversation |
| `escalated` | `markEscalated` | handed to a human; terminal for the agent |
| `dormant` | — | **declared but never written.** Vestigial; retained because removing an allowed value would be a narrowing change |
| `opted_out` | `markStopped` | customer asked to stop |
| `human_active` | `markHumanActive`, `markHumanActiveByConversation` | rep sent a message. **Permanent** |
| `closed` | `markClosed` | explicit end of the interaction. Reopens only on `isExplicitReopen` — a real question, new need, or handoff request |

**Presence columns live on this same row** — `humanTypingUntil`, `humanTypingAt`,
`humanTypingUserId` (migration `20260823120000`). Deliberately not a second table:
the guard already loads this row, presence and `aiState` must be read together and
can never disagree, and `ON DELETE CASCADE` from `inbox_conversations` already
cleans it up.

Typing **never** writes `aiState` — asserted at SQL level. A rep who starts a
sentence and abandons it must not silence the agent permanently.

Both presence writes are **agency-scoped inside the statement**
(`FROM inbox_conversations c WHERE c."agencyId" = :agencyId`), so IDOR-safety does
not depend on a caller remembering to check.

---

## 5. Migration `20260823130000_conversation_ai_state_allow_closed.cjs`

**The defect it fixes:** `markClosed()` writes `'closed'` and five call sites read
it back, but the CHECK from `20260625000001` never listed it. Worst case was
`processNoResponseJob` — the customer receives the closing message, the write then
raises `23514`, the job retries and dead-letters, and the conversation stays
`ai_qualifying` with the reopen path unreachable.

**Framing correction on record:** this was never shipped. At the time of the fix
the entire `closed` lifecycle (`markClosed`, the `AiState` member,
`noResponseClose.ts`, `conversationControl.ts`) was uncommitted work — a missing
migration in in-flight work, not a production incident. No production row could
hold `'closed'`, so there was no data to migrate.

| Aspect | Behaviour |
| --- | --- |
| **Change** | Purely additive: the original six values **+** `'closed'`. `dormant` retained |
| **Discovery** | By **table + column** via `pg_constraint.conkey` → `pg_attribute.attname`, never by name. The original was inline in `CREATE TABLE`, so Postgres auto-named it `conversation_ai_state_aiState_check` — mixed-case, needs quoting, not guaranteed stable. A `FOR` loop drops every CHECK covering the column, so re-runs and hand-made duplicates cannot leave a stale narrow constraint |
| **New name** | `conversation_ai_state_aistate_check` — explicit, lowercase, quote-free |
| **Application** | `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT`. *Honest caveat:* knex wraps migrations in a transaction, so the `ACCESS EXCLUSIVE` lock is held to commit either way — the split does not buy its usual lock-avoidance here. Kept because the `ADD` stays instant, validation is explicit, and it is the right shape if this ever runs outside a transaction |
| **Rollback** | Checks for `'closed'` rows **first, before dropping anything**, and aborts with a row count and an actionable `HINT`. Verified live: schema untouched, all rows preserved. With no such rows it restores exactly the original six-value vocabulary |
| **Idempotency** | `up()` run twice leaves exactly one constraint |

`20260819120000_auto_response_jobs_no_response.cjs` was **not** modified — the fix
is a separate migration, safe even where that one has already been applied.

---

## 6. Regression protection — AiState ↔ SQL drift

`__tests__/inbox/autoresponse/aiStateConstraint.test.ts` (10 tests, no database).

It runs each migration's `up`/`down` against a recording stub and asserts on the
**real emitted SQL**, not a source regex — so a migration that builds its
statement differently is still checked on what it actually executes.

Asserted: every `AiState` union member is allowed by the newest constraint; the
constraint allows nothing the union does not declare; `'closed'` specifically is
present; the migration never narrows (`dormant` survives); discovery does not
depend on the auto-generated name; `NOT VALID` precedes `VALIDATE`; drop precedes
add; `down()`'s guard precedes any drop; rollback restores the original set.

**Mutation-tested, not merely green.** Three mutations were each caught with a
clear message before the file was restored byte-identical:

| Mutation | Caught as |
| --- | --- |
| Drop `'closed'` (the original defect) | `AiState value(s) with no persisted constraint entry: closed` |
| Drop `'dormant'` (narrowing) | `constraint no longer allows: dormant` |
| Remove the rollback guard | `down() has no closed-row guard` |

This closes the gap that let the defect through: every close-lifecycle test mocks
`@/db/conversationAiState`, so the writer's SQL never runs, and DB-backed
integration tests cannot run at all (§8).

---

## 7. Verification status

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean, exit 0** |
| `__tests__/inbox` + `whatsapp` + `ai` + `today` | **2485 passed, 12 skipped, 0 failed** |
| `npm run test:a11y` | **435 passed** |
| Human Presence suite (`__tests__/inbox/humanPresence/`) | **96 passed** |
| Live PostgreSQL migration verification | **22/22 checks, exit 0** |

The live verification ran in an isolated schema against a real database: it
reproduced the exact original DDL, confirmed the baseline defect (`'closed'`
rejected, SQLSTATE `23514`), applied `up`, confirmed all seven states accept and
an unknown state still rejects, exercised **both** rollback paths, and confirmed
`up()` is idempotent.

---

## 8. Open infrastructure issue — migration-chain drift

**`npx knex migrate:latest` cannot complete on a fresh schema.** It fails early:

```
CREATE UNIQUE INDEX clients_lead_source_unique … — relation "clients" does not exist
```

The knex chain assumes base tables (`clients`, `agencies`, …) created by the
Prisma-era system, which is **not in the repository** — there is no
`schema.prisma`, and `db/migrations/` holds only two vestigial `.sql` files while
`migrations/` holds the 85 live knex files. `scripts/migrate.cjs` points at the
former and is dead.

**Consequences, stated plainly:**

- DB-backed integration tests cannot run. ~23 test files fail with
  `relation … does not exist` under `VITEST_NO_DB=1`; this is environmental, not a
  code regression.
- The **migration chain** is unverified end-to-end. Individual migrations can be
  verified in isolation (as `20260823130000` was), but ordering and cross-table
  interactions cannot.
- Schema defects reach review unexercised. The `closed` gap is the worked example:
  it survived ~40 assertions because every one mocked the writer.

This is the single highest-leverage infrastructure fix available. Until it lands,
**SQL-level assertions on emitted SQL are the required substitute** for any
schema-touching change — see §6 for the pattern, and `db/today/facts.ts` for the
query-builder/executor split that makes readers testable under it.

---

## 9. Deferred: file-size debt

`lib/inbox/autoresponse/qualifyWorker.ts` (**609 lines**) and
`lib/inbox/autoresponse/worker.ts` (**302 lines**) are over the 250-line soft
limit in `claude/architecture-rules.md` §1. Both were already over it before this
work, which added ~15 lines to each.

**Intentionally deferred**, on instruction and per CLAUDE.md §4. New logic was
pushed into focused modules (`humanPresence.ts`, `agentSendGuard.ts`,
`humanPresenceWatch.ts`, `db/conversationHumanPresence.ts`,
`lib/inbox/humanTakeover.ts` — all 56–150 lines) rather than inlined, so the
orchestrators grew as little as possible.

**Owed on next touch** (architecture-rules §8). Natural seams in `qualifyWorker`:
the generate → validate → repair ladder, the draft/canary branch, the escalate
branch. Raise it as its own change; do not bundle it into a feature.

---

## Risks and priorities

| # | Item | Severity | Note |
| --- | --- | --- | --- |
| R1 | Migration-chain drift blocks all DB-backed testing (§8) | **High** | Systemic. Every schema change ships unexercised; the `closed` defect is the proof |
| R2 | `qualifyWorker.ts` at 609 lines (§9) | Medium | Deferred by decision. Cost is review difficulty, not correctness |
| R3 | Presence adds ~2 reads per turn plus a 1.5s poll during generation | Low | Single indexed row by PK. Accepted; watch under load |
| R4 | `dormant` is declared but never written | Low | Vestigial. Retained deliberately — removal is a narrowing change |
| R5 | Human Presence covers WhatsApp only | Low | `InboxChannel` is a single-member union; no other channel exists to protect |

**Priority order:** R1 first — it is the only item that makes future defects
likely rather than merely untidy. R2 on the next substantive touch of the file.
R3–R5 are observations, not actions.

**Frozen:** Human Presence and the `closed`-state migration. Changes to either
require a concrete, demonstrated correctness defect — not a refactor opportunity.
