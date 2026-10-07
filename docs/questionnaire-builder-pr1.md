# Questionnaire Builder: PR1 technical design (domain, storage, API foundation)

- **Status:** design gate. Not implemented, no migration created.
- **Date:** 2026-10-06.
- **Product direction:** `claude/research/product/whatsapp-questionnaire-builder.md`
  (approved: conversation editor, mobile V1 view/test/switch, arrow reordering).
- **Runtime baseline:** `origin/main` `9dee7e0c`. Perfect Picture (agency 158) is live on
  revision 4; agency 103 is on revision 1.

**PR1 goal.** Let SocialCRM safely:
1. load a published questionnaire;
2. create and edit an isolated draft;
3. validate it with the real questionnaire schema;
4. simulate it with production logic;
5. publish an immutable new revision without affecting existing sessions.

No polished Builder UI.

---

## 0. Implementation notes (PR1 as built, 2026-10-06)

Where the implementation deliberately differs from the design below:

- **Publish is not activation.** Publish writes the revision row and the live copy
  (`auto_response_settings.questionnaire`, only when a settings row exists). It never
  writes `responder` / `enabled`, and never creates a settings row (§12).
- **No `processJob` refactor (§10).**
  - Every decision function the simulator needs was already pure and shared:
    `inboundInputs`, `firstAskedAt`, `decideQuestionnaireTurn` (matching, validation,
    not-set, customer questions, corrections, bursts, branching, endings) and the
    renderers.
  - The only logic production runs in SQL is the session bookkeeping. The simulator
    mirrors it (`builder/simulate.ts`), and the parity test against the real worker
    guards it (`builderParity.db.test.ts`, 14 scenarios). A mutation check confirmed
    the test catches a divergence.
  - The deployed runtime is unchanged.
- **Builder field names.** A custom ending's condition is `sentWhen` (not `when`), so
  no engine word reaches the API.
- **The draft is stored in runtime form.** Save therefore refuses what the V1 runtime
  cannot hold, rather than dropping it:
  - more than one condition on a question;
  - a custom ending without exactly one condition;
  - "not understood" messages on a choice question.
- **Staff script:**
  - `--publish` publishes only, through the service.
  - `--enable` checks the settings row exists, publishes through the service, then
    routes the agency as a separate explicit step.
  - It refuses over an owner draft unless `--discard-draft` is given.
- **Immutability:** enforced by the trigger. The only escape is a transaction-local
  purge (`SET LOCAL questionnaire.allow_purge = 'on'`), which permits DELETE only, never
  UPDATE. It exists for agency deletion and test cleanup.
- **`openDraft` refuses `history_missing`** if a live definition exists with no
  recorded revision (i.e. before the backfill), instead of guessing.

## 1. Decisions recorded

| Decision | Status |
| --- | --- |
| Conversation editor is the primary Builder UX | Approved |
| Mobile V1: view, simulate, enable/disable where safe; editing desktop-first | Approved |
| Reordering: existing up/down arrows, no drag-and-drop dependency. The data model holds explicit stable order | Approved |
| New revision storage | **Decided here** (§2). Not yet approved |
| Location answer type | Recommended here (§3). Not built in PR1 |
| Multiple conditions | Deferred. The domain shape must not assume one (§4) |
| External product observations | Non-authoritative inspiration only. No decision depends on them |

---

## 2. Storage options

### 2.1 What exists in production today

| Table | Columns that matter | Role today |
| --- | --- | --- |
| `auto_response_settings` (PK `agencyId, channel`) | `questionnaire jsonb`, `responder text CHECK IN ('agent','questionnaire')`, `enabled bool DEFAULT false`, `updatedAt`, `updatedBy`, plus an **unrelated** `draft boolean` | The **current published definition**. The runtime reads it via `getChannelSettings` (`db/autoResponseSettings.ts`) on every questionnaire turn. The owner's settings form writes the same row (`actions/autoResponse/updateSettings.ts`) |
| `questionnaire_sessions` | `definition jsonb NOT NULL`, `definitionRevision int` | **Session pinning.** `startSession` freezes the full definition at the first question. `processJob` runs a live session on that frozen copy (shipped in `121b3d63`) |

**Key fact.** Pinning already holds, by full snapshot in the session row. It does not
depend on any revision store. Neither option below touches `questionnaire_sessions` or
changes pinning.

**What production storage cannot do today:**
- hold a draft;
- detect concurrent edits;
- keep revision *N* after *N+1* is written. `configure.ts` overwrites the jsonb, and
  revision *N* survives only inside sessions that happened to run it;
- record who published what;
- recreate an old revision.

### 2.2 Option A: reuse `auto_response_settings`, add draft/revision metadata

**New columns on `auto_response_settings`:**

| Column | Type |
| --- | --- |
| `questionnaireDraft` | `jsonb NULL` |
| `questionnaireDraftVersion` | `int NOT NULL DEFAULT 0` |
| `questionnaireDraftBaseRevision` | `int NULL` |
| `questionnaireDraftUpdatedAt` / `questionnaireDraftUpdatedBy` | |
| `questionnairePublishedAt` / `questionnairePublishedBy` | |

| Concern | Behaviour |
| --- | --- |
| Immutable revision | **Not met.** Publishing *N+1* replaces the jsonb, so *N* stops existing as a record. It survives only in the snapshots of sessions that ran it; a revision no conversation reached is lost |
| Session pinning | Unchanged (session snapshot) |
| Draft | Separate column; the runtime never reads it ✓ |
| Concurrency | `questionnaireDraftVersion` conditional update ✓. But draft autosaves now write the hot row every inbound reads, and the row the owner's settings form writes |
| Rollback/republish | **Impossible** for any revision with no session snapshot. `listRevisions` would be "current + whatever sessions remember" |
| Audit | Only the last publisher; overwritten each time |
| 103 / 158 | Work in place; no backfill needed |
| New agency (no settings row) | Opening a draft must **insert a settings row**. Its defaults include `replyMode 'ai'`, so a row now exists where `getChannelSettings` returned `null`, which changes what the settings page considers "configured" |
| Migration | 7 additive columns, no backfill |
| Query / runtime | Trivial / none |
| Failure modes | Naming collision with the existing `draft boolean`; draft writes contend on the hot settings row; history silently unavailable |

### 2.3 Option B: dedicated revision storage, draft as a row, settings keeps the live copy

**One new table, `questionnaire_revisions`:**

| Column | Type / rule |
| --- | --- |
| `id` | `bigserial PRIMARY KEY` |
| `agencyId` | `integer NOT NULL` (no FK, like `questionnaire_sessions`) |
| `channel` | `text NOT NULL DEFAULT 'whatsapp'` |
| `status` | `text NOT NULL CHECK (status IN ('draft','published'))` |
| `revision` | `integer NULL`. Set at publish |
| `definition` | `jsonb NOT NULL` |
| `draftVersion` | `integer NOT NULL DEFAULT 1` |
| `baseRevision` | `integer NULL`. The published revision the draft was copied from |
| `source` | `text NOT NULL DEFAULT 'builder' CHECK (source IN ('builder','staff','backfill'))` |
| `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | |
| `publishedBy`, `publishedAt` | `NULL` while a draft |
| check | `(status='draft' AND revision IS NULL AND "publishedAt" IS NULL) OR (status='published' AND revision IS NOT NULL AND "publishedAt" IS NOT NULL)` |
| unique | `("agencyId", channel, revision)`; NULL revisions are not compared |
| unique partial | `("agencyId", channel) WHERE status = 'draft'`: one draft per agency+channel |
| trigger | `BEFORE UPDATE OR DELETE`: raise if `OLD.status = 'published'`. **History is immutable in the database**, not just by convention |

**The current pointer is `auto_response_settings.questionnaire`, unchanged.** The publish
transaction writes the new definition there in the same transaction as the revision row.

- The runtime keeps reading exactly what it reads today, so there is **zero runtime
  change**.
- No pointer column is added, because the definition already carries its own
  `revision`.
- Invariant: for an agency with any published row,
  `settings.questionnaire.revision = max(revision)`.

| Concern | Behaviour |
| --- | --- |
| Immutable revision | ✓ The published row can never be updated or deleted (trigger) |
| Session pinning | Unchanged (session snapshot). Publishing touches no session row |
| Draft | A `status='draft'` row; the runtime never reads this table |
| Concurrency | `draftVersion` conditional update; publish locks the draft row and the settings row |
| Rollback/republish | Open a draft from revision *K* → publish *N+1* with *K*'s content. Revisions only move forward, so pins and audit stay coherent |
| Audit | Per revision: `publishedBy`, `publishedAt`, `source` |
| 103 / 158 | Backfilled as published rows from the current jsonb (§12) |
| New agency (no settings row) | Draft needs no settings row; the settings row is created only **at publish**, with `enabled` left at its default `false` |
| Migration | 1 table, 2 indexes, 1 check, 1 trigger, a backfill `INSERT … SELECT` |
| Query complexity | Draft by `(agencyId, channel, status)` index; publish is 5 statements in one transaction |
| Runtime impact | None |
| Failure modes | (a) A writer that updates `settings.questionnaire` without going through publish breaks the invariant. The only such writer is staff `configure.ts`, so PR1 routes it through the publish service. (b) Trigger semantics must be covered by the CI schema check (`.github/workflows/schema.yml` runs on `migrations/`) |

## 3. Storage recommendation: **Option B**

**Option A cannot satisfy the approved lifecycle.** "PUBLISH IMMUTABLE REVISION" then
"EDIT NEXT DRAFT" then "PUBLISH N+1" requires revision *N* to keep existing after *N+1*
is published. Under A it doesn't, except by accident in session snapshots, so:
- rollback and republish are impossible for unseen revisions;
- `listRevisions` is incomplete;
- audit keeps only the latest publisher.

A also puts draft autosaves on the hot settings row, and materialises settings rows for
agencies that have never saved settings.

**B is the smallest schema that is correct:**
- a single table holds both the draft and the immutable history;
- the existing column stays the live copy, so the runtime does not change;
- immutability is enforced by the database.

It adds one table, not two. A separate draft table was considered and rejected: the
partial unique index gives one-draft-per-agency without it.

---

## 4. Location type recommendation

- **Recommendation: a Builder-level preset, not a new runtime validator.**
- **The runtime already has the right semantics.** `validate: 'meaningful'` +
  `allowNotSet` was proven on the full location corpus in the audit:
  - It accepts places, areas, "בבית", "באולם", "ליד רחובות" and multi-place answers.
  - It records "עוד לא סגרנו אולם" as not-set.
  - It rejects "איפה", "?", questions to the business, bare dates and corrections.
- **What the owner sees:** **מיקום / מקום**, with the location re-ask copy as a default.
- **The one thing a pure preset cannot do is round-trip.** After a reload, the editor
  could not tell "location" from "text with not-set". So the preset persists a single
  **presentation-only** field on the text question, `answerHint: 'place'`.
  - It works like `icon`: never read by the runtime, never matched, never shown to the
    customer or the rep.
  - It is the only runtime-schema addition the preset needs, and it does not change
    behaviour.
- **Not in PR1.** PR1's domain model reserves the `place` answer kind (§7.2) so the
  editor PR adds only the hint field.
- **Rejected alternatives:**
  - A new validator (`validate: 'place'`): a runtime primitive with identical behaviour
    is a second name for the same thing.
  - Extending `meaningful`: it is already conservative enough.

## 5. Multiple conditions

- **Deferred.** V1 runtime and UI support exactly one condition per question, and per
  custom ending. Perfect Picture revision 4 is fully expressible with one.
- **The domain API never encodes "exactly one".** The Builder shape is
  `shownWhen: { mode: 'always' } | { mode: 'all', conditions: Condition[] }`.
  - PR1 compiles 0 conditions to no `when`, and 1 condition to the runtime `when`.
  - More than 1 is a publish issue, `conditions_more_than_one_not_supported_yet`.
- Adding AND later is therefore:
  - a runtime `when` extension (array of conditions);
  - removing that one check;
  - extending the condition row editor.

  Nothing else in the API or the stored drafts changes. OR is reachable the same way
  (`mode: 'any'`).

---

## 6. PR1 scope

1. Migration for `questionnaire_revisions`, with backfill of the current published
   definitions (§13). Applied manually, before deploy, per `release-deployment-workflow.md` §8b.
2. Builder domain model and its lossless conversion to and from the runtime definition.
3. Stable id assignment.
4. Draft and publish validation layers.
5. Simulator on shared production decision logic, including the extraction of the one
   piece of decision → state logic that today lives only in `processJob`.
6. Server actions with authorization, tenancy, optimistic concurrency, idempotent
   publish.
7. Staff `configure.ts` routed through the publish service.
8. A feature flag, `QUESTIONNAIRE_BUILDER_AGENCY_IDS`. Absent means no agency; documented
   per the Feature Rollout Standard.
9. Tests (§16).

**PR1 non-goals:**
- **Editor UI.** No conversation editor, preview pane, route view or mobile view.
- **New runtime behaviour.** No location hint field, multiple conditions, per-question
  fallback, configurable not-set text, or choice-question `invalidPrompt`.
- **Enable/disable.** It stays the existing switches. Unpublishing stays staff-only.
- **Templates.** Other than the existing sample files.
- **Backfilling 158 revisions 1–3** (§13).
- **Drag and drop.**
- **Changes to the runtime read path, the worker or session pinning.**

---

## 7. Domain model

### 7.1 One source of truth

- **The persisted source of truth is the runtime `QuestionnaireDefinition`**, the
  existing zod schema in `lib/inbox/autoresponse/questionnaire/definition.ts`. That is
  what the runtime, the session snapshot and the revision row all hold.
- **The API speaks a Builder model.** The runtime fields that ARE engine terminology
  (`when`, `closingVariants`, `validate`, `allowNotSet`, `aliases`) are re-expressed in
  product terms.
- **The Builder model is never stored.** It is converted losslessly:
  - `toBuilder(definition)` for reads;
  - `toDefinition(builder)` for writes.

  Both are pure, and a round-trip test proves losslessness on every real definition
  (103, 158 revision 4, the samples).
- **Everything that isn't engine terminology passes through 1:1.** That covers ids,
  prompts, labels, icons, order and messages, so there is no needless mapping layer.

### 7.2 Builder model (TypeScript shape, abridged)

```ts
type BuilderQuestionnaire = {
  opening: string                      // ← welcome
  questions: BuilderQuestion[]         // ← steps, IN ORDER (array order is the stable order)
  endings: {
    standard: string                   // ← closing
    custom: BuilderEnding[]            // ← closingVariants, in priority order
  }
  handoffMessage: string               // ← handoff
  settings: { attemptsBeforePerson: number; abandonAfterHours: number } // ← maxInvalidAttempts, expireAfterHours
  summaryTitle: string                 // ← summaryTitle
}

type BuilderQuestion = {
  id: string                           // server-assigned, stable; NEVER shown to the owner
  label: string                        // the short name the rep reads in the summary
  prompt: string                       // what the customer sees
  answer: AnswerSpec                   // how the customer answers
  shownWhen: ShownWhen                 // when the question appears
  messages?: { notUnderstood?: string; askAgainAfterQuestion?: string } // ← invalidPrompt, reaskPrompt
}

type AnswerSpec =
  | { kind: 'single_choice' | 'multi_choice'; options: BuilderOption[] }
  | { kind: 'text' }                        // ← text + validate 'meaningful'
  | { kind: 'date'; notSetAllowed: boolean } // ← text + validate 'date' + allowNotSet
  | { kind: 'place'; notSetAllowed: boolean } // reserved (§4); not accepted by PR1 writes
  | { kind: 'text_unchecked' }              // ← text with no validate (legacy, e.g. 103); round-trips untouched

type BuilderOption = { id: string; label: string; icon?: string; phrasings: string[] } // phrasings ← aliases

type ShownWhen =
  | { mode: 'always' }
  | { mode: 'all'; conditions: Array<{ questionId: string; anyOf: string[] /* option ids */ }> }

type BuilderEnding = { when: ShownWhen & { mode: 'all' }; message: string }
```

### 7.3 Read view (derived, never stored)

`describeQuestionnaire(definition)` returns, for each question, the three things the
approved editor shows:

| Concept | Field | Derived from |
| --- | --- | --- |
| **מה הלקוח רואה** | `customerSees: string` | `renderQuestion(step)` / `renderOpening`. The exact production text: menu numbering, icons, multi-select hint, נציג hint |
| **איך הוא יכול לענות** | `answer: AnswerSpec` + `answerSummary` ("בחירה אחת · 7 אפשרויות", "תאריך · אפשר להמשיך גם בלי תאריך") | `toBuilder` |
| **מתי השאלה מופיעה** | `shownWhen` + `shownWhenText` ("רק אם: סוג האירוע הוא חתונה, חינה") | `when` + option labels |

It also derives `routes`, the read-only outline of the approved route view, and which
ending each route receives. The frontend never reads `when`, `closingVariants` or
`validate`.

---

## 8. Stable ids

- **Assigned server-side, by `assignIds(previousDraft, incoming)`:**

  | Incoming item | Result |
  | --- | --- |
  | Question or option with **no id** | New entity: `q_<8 base36>` / `o_<8 base36>`, unique within the definition, matching the runtime `ID` regex `[a-z0-9_]{1,40}` |
  | **Existing id** | Kept. Changing "מה תאריך האירוע?" to "באיזה תאריך האירוע?" only edits `prompt`; the id is unchanged |
  | An id **not present in the current draft** | **Rejected** (`unknown_id`). The client cannot mint, forge or resurrect identities |
  | **Copy** of a question | The client sends it without an id, so a new identity is created (and new option ids) |
  | **Delete + recreate** | A new id. Recreation is therefore deliberate; a deleted id is never reused within a draft |

- **Existing semantic ids are preserved forever** (`event_type`, `wedding`, …). Only new
  entities get generated ids.
- **Order is the array order**, persisted as-is. Arrows (V1) and drag-and-drop (later)
  both just reorder the array. Publish validation rejects an order that puts a question
  before one it depends on (the runtime rule: conditions only look backwards).

---

## 9. Validation layers

| Layer | When | Rule | On failure |
| --- | --- | --- | --- |
| **Draft** | every save | `builderDraftSchema`, lenient. Types, string max lengths (runtime limits), counts (≤ 12 questions, ≤ 10 options per question), id rules (§8), customer-text dashes normalised to commas (runtime parity). **Allows** an empty prompt, < 2 options, no ending, a dangling condition | Save refused only for structural or safety violations; everything else is stored and returned as non-blocking `issues` |
| **Publish** | `checkQuestionnaireDraft`, `publishQuestionnaireDraft` | `toDefinition` → **`questionnaireDefinitionSchema` (the real runtime zod)** → Builder referential checks (below) | Each zod issue is translated to a `BuilderIssue { code, severity, questionId?, optionId?, field }`. The UI maps `code` to Hebrew, following the `sheetOptions.ts` `ERRORS` pattern. No raw zod text ever leaves the server |
| **Runtime** | every turn | Unchanged | Unchanged |

**Builder referential checks (publish):**
- a question no combination of answers can reach (`unreachable_question`);
- more than one condition (`conditions_more_than_one_not_supported_yet`);
- a rendered message over `MAX_RENDERED_MESSAGE_CHARS` (the check `configure.ts`
  already does);
- an ending or condition referring to a deleted option (zod catches it; translated with
  ids);
- an "אחר" option with no follow-up (`other_without_follow_up`, **warning**);
- a route with no custom ending (**informational**).

Errors block publish; warnings don't.

---

## 10. Simulator parity design

**Principle.** Given definition D, state S and message M, the simulator and production
call the **same functions in the same order**. The simulator only wraps the result.

**One piece of decision → state logic exists only inside `processJob` and the
persistence layer today:**
- how a decision becomes the next session (`commitTurn`: `currentStepId`, `answers`,
  `invalidCount`, `lastConsumedSequence`, `version + 1`, `lastPromptAt`;
  `startSession`; `endSession`; `consumeUpTo`);
- how `aiState` moves.

PR1 extracts it into a pure `nextSessionState(session, decision, now)` in a new
`questionnaire/turnState.ts`. `processJob` uses it to build the arguments it already
passes to `persistQuestionTurn`, `startSession` and `persistTerminal`. This is a
behaviour-neutral refactor, proven by the existing worker, race and pinning DB suites.

**`simulateQuestionnaireDraft`:**
1. **Replays the whole conversation from scratch on each call.** It holds no state; the
   client sends the customer turns so far. That is the `AgentPreview` model.
2. **Builds synthetic transcript rows identical in shape to production rows.** Inbound
   rows are `{direction, type:'text', text, sequence}`. Outbound rows carry `metadata`
   `{source:'auto_response', kind:'questionnaire', questionnaireTurnKey,
   questionnaireStepId}`.
3. **Runs the production functions on them:** `inboundInputs` → `firstAskedAt` →
   `decideQuestionnaireTurn` (facts: routed, no human, the aiState from
   `nextSessionState`) → `nextSessionState` → `renderSummary` / `summaryFields`.
4. **Accepts `turns: string[][]`.** Each turn is one customer message, or a burst sent
   together, so burst behaviour is simulable too.
5. **Returns, per turn:** the outbound text, plus an `explanation` derived from the
   decision. The explanation is never computed independently:
   - `reason`;
   - the option matched and the words it was recognised from (`:raw`);
   - not-set;
   - extras (`:unplaced`, `:questions`, `:corrections`);
   - the attempt count;
   - the next question.

   It also returns the final rep summary.

**Out of scope for the simulator, and covered by tests:** human takeover, opt-out
compliance stop, the service window, duplicate deliveries, the owner-echo race.

**Parity proof:** a DB test runs a corpus of conversations through both:
- the real worker (ingest → job → claim → `processJob`, Graph send faked);
- `simulateQuestionnaireDraft`.

It asserts identical per-turn `reason` and outbound text, and identical final `answers`
and `status`. The corpus covers:
- Perfect Picture: bar mitzvah, wedding, drone, other, invalid date, not-set, customer
  question, a burst, a correction, נציג;
- the salon flow;
- 103's pilot flow.

---

## 11. API / service contracts

**Layering:**
- server actions in `actions/questionnaire/builder*.ts`, which authorize;
- the domain in `lib/inbox/autoresponse/questionnaire/builder/`, which is pure;
- persistence in `db/questionnaireRevisions.ts`.

**Every action:**
1. `const user = await requireProductAccess()`
2. `if (!isAdmin(user.role)) → { ok: false, reason: 'forbidden' }`
3. `if (!canUseQuestionnaireBuilder(user.agencyId)) → 'forbidden'`
4. `agencyId = user.agencyId`, `channel = 'whatsapp'`

No action accepts an agency id. Every DB function takes `agencyId` from the caller and
filters on it.

| Action | Input | Output | DB | Transaction | Errors |
| --- | --- | --- | --- | --- | --- |
| `getQuestionnaireBuilderState()` | — | `{ published: { revision, publishedAt, publishedBy, questionnaire, view } \| null, draft: { draftId, draftVersion, baseRevision, updatedAt, questionnaire, view, issues } \| null, live: { responder, enabled, masterEnabled }, activeSessionsByRevision: Array<{ revision, count }> }` | read latest published row, draft row, settings, session counts | none | forbidden |
| `openQuestionnaireDraft({ fromRevision? })` | optional revision to start from (rollback/republish) | the `draft` block | existing draft → return it; else insert a draft row copied from `fromRevision` / latest published / an empty skeleton (new agency) | single INSERT (unique index makes a concurrent open return the winner's row) | forbidden · `draft_exists` (only when `fromRevision` is given and a draft exists) · `revision_not_found` |
| `saveQuestionnaireDraft({ draftId, expectedVersion, questionnaire })` | full Builder model (autosave-friendly) | `{ draftVersion, questionnaire (ids assigned), view, issues }` | `UPDATE … SET definition, draftVersion = draftVersion + 1, updatedBy/At WHERE id AND agencyId AND status = 'draft' AND draftVersion = expected` | single statement | forbidden · `not_found` · `version_conflict { currentVersion }` · `draft_published` · `invalid_draft { issues }` · `unknown_id` |
| `discardQuestionnaireDraft({ draftId, expectedVersion })` | — | `{ ok }` | `DELETE … WHERE id AND agencyId AND status = 'draft' AND draftVersion = expected` | single statement | forbidden · not_found · version_conflict |
| `checkQuestionnaireDraft({ draftId })` | — | `{ ready: boolean, issues: BuilderIssue[] }` | read draft | none | forbidden · not_found |
| `simulateQuestionnaireDraft({ draftId?, revision?, turns: string[][] })` | draft (default) or a published revision | `{ turns: Array<{ customer: string[], replies: string[], explanation }>, status, summary: { title, fields } }` | read draft/revision only; **writes nothing**; nothing sent, no lead, no notification | none | forbidden · not_found · `too_long` (turn cap, e.g. 40) · `not_ready { issues }` (a definition that fails publish validation cannot be simulated, so the result is never a lie) |
| `publishQuestionnaireDraft({ draftId, expectedVersion })` | — | `{ revision, publishedAt, alreadyPublished?: true }` | §12 | **one transaction** | forbidden · not_found · version_conflict · `draft_out_of_date { latestRevision }` · `invalid { issues }` |
| `listQuestionnaireRevisions()` | — | `Array<{ revision, publishedAt, publishedBy, source, activeSessions }>` | read published rows + session counts | none | forbidden |
| `getQuestionnaireRevision({ revision })` | — | `{ questionnaire, view }` | read one published row | none | forbidden · revision_not_found |

**Staff path.** `scripts/questionnaire/configure.ts --enable` calls the domain function
`publishDefinition({ agencyId, definition, source: 'staff' })` instead of writing the
jsonb directly:
- It is the same transaction as §12, with an implicit draft.
- It refuses if an owner draft exists (`--discard-draft` to override deliberately).
- `--show` lists revisions.

---

## 12. Publish transaction

**Before the transaction:** authorization (`requireProductAccess`, `isAdmin`, flag).

```
BEGIN
 1. SELECT * FROM questionnaire_revisions
      WHERE id = :draftId AND "agencyId" = :agencyId AND channel = 'whatsapp'
      FOR UPDATE                                    -- serialises double clicks and concurrent publishers
    · no row                → ROLLBACK, not_found
    · status = 'published'  → idempotent replay: if row."draftVersion" = :expectedVersion
                               → COMMIT, return { revision, alreadyPublished: true }; else version_conflict
    · draftVersion ≠ expected → ROLLBACK, version_conflict
 2. SELECT questionnaire, responder FROM auto_response_settings
      WHERE "agencyId" = :agencyId AND channel = 'whatsapp' FOR UPDATE   -- may be absent (new agency)
    latest := max(revision) of this agency's published rows
    · draft.baseRevision IS DISTINCT FROM latest → ROLLBACK, draft_out_of_date  -- staff published meanwhile
 3. next := GREATEST(latest, settings.questionnaire.revision, 0) + 1
    definition := toDefinition(draft.builder) with revision = next
    validate: questionnaireDefinitionSchema + Builder checks → any error → ROLLBACK, invalid { issues }
 4. UPDATE questionnaire_revisions
       SET status = 'published', revision = :next, definition = :definition,
           "publishedBy" = :userId, "publishedAt" = now(), "updatedAt" = now()
     WHERE id = :draftId AND status = 'draft' AND "draftVersion" = :expectedVersion
    · rowCount ≠ 1 → ROLLBACK, version_conflict
    (the trigger allows this: OLD.status is 'draft')
 5. UPDATE auto_response_settings
       SET questionnaire = :definition, "updatedBy" = :userId, "updatedAt" = now()
     WHERE "agencyId" = :agencyId AND channel = 'whatsapp'
    -- ONLY the live definition. `responder`, `enabled` and the master switch are never written:
    -- publishing is not activation (decision 2026-10-06). No settings row → none is created;
    -- the revision exists, and a future activation flow writes the live copy when it turns routing on.
COMMIT
after commit: track('questionnaire_published', { revision, source })  -- best effort, outside the transaction
```

- No statement touches `questionnaire_sessions`, so active sessions are untouched.
- Any failure rolls back everything, so there is no partial publish.
- The unique `(agencyId, channel, revision)` index is the last-line guard against a
  duplicate revision number.
- **Publishing never changes routing.** It does not set `responder`, `enabled` or the
  master switch, and does not create a settings row (decision 2026-10-06: publish ≠
  activate).
  - An agency already routed to the questionnaire runs the new revision for new
    conversations.
  - An agency on the AI agent stays on the AI agent, with the new definition stored
    and inert.
  - A new agency gets only the revision row.
- Publishing does not bypass the runtime rollout gate (`WA_QUESTIONNAIRE_AGENCY_IDS`).

## 13. Idempotency

The draft row is the idempotency token. It transitions `draft → published` exactly once
(conditional UPDATE + trigger).

A double click sends two requests with the same `draftId` and `expectedVersion`:
1. The second waits on `FOR UPDATE`.
2. It sees `status = 'published'` with the matching `draftVersion`.
3. It returns the same revision with `alreadyPublished: true`.

Revision *N+2* cannot be created: no draft exists any more, and the revision number is
unique. No separate idempotency-key column is needed.

## 14. Concurrency

| Scenario | Result |
| --- | --- |
| Tab A and tab B load v5; A saves | A gets v6 |
| B then saves with v5 | `version_conflict { currentVersion: 6 }`. Never last-write-wins. The UI offers "load latest" |
| A publishes while B still holds v6 | B's save → `draft_published`; B's publish → idempotent replay only if B's version matches, otherwise conflict |
| Staff publish (`configure.ts`) while an owner draft exists | Refused unless `--discard-draft` |
| Owner draft based on revision *N*, latest is now *N+1* | `draft_out_of_date`. The owner must reopen from latest or discard. No silent overwrite of someone else's publish |
| Two concurrent `openQuestionnaireDraft` | The partial unique index lets one INSERT win; the other reads the winner's row |

## 15. Existing agencies 103 / 158

**Migration backfill:**

```sql
INSERT INTO questionnaire_revisions
  ("agencyId", channel, status, revision, definition, source, "publishedAt", "createdAt", "updatedAt")
SELECT "agencyId", channel, 'published', (questionnaire->>'revision')::int, questionnaire,
       'backfill', now(), now(), now()
  FROM auto_response_settings
 WHERE questionnaire IS NOT NULL AND (questionnaire->>'revision') ~ '^[0-9]+$'
```

- In production this creates:
  - **103**: revision 1 (pilot definition);
  - **158**: revision 4 (the definition read back on 2026-10-06).
- `publishedAt` is the migration time, honestly labelled `source = 'backfill'`, and
  `publishedBy` is `NULL`. **No publish time or publisher is invented.**
- The migration's pre-check (dry run, read-only):
  - Lists every row with a non-null `questionnaire`, so nothing unexpected is
    backfilled.
  - Asserts each one parses with the runtime schema.
  - Fails loudly instead of skipping silently.

**Flow, with no rebuild:**
1. `getQuestionnaireBuilderState` returns published revision 4.
2. `toBuilder` converts it losslessly (round-trip tested on the exact production
   definition).
3. `openQuestionnaireDraft` copies revision 4 into a draft with `baseRevision 4`.
4. `publishQuestionnaireDraft` creates revision 5.

**History before the migration:**
- **Starts at:** 158's history starts at revision 4, 103's at revision 1.
- **Recoverable for 158, not backfilled in PR1:**
  - revisions 1 and 2 exist byte-exact in the session snapshots (session 18 → 1;
    sessions 21/22 → 2);
  - revision 3 is the sample file at `f08b82b4`, which was verified identical to
    production at apply time.

  A later, optional backfill could add them with `source = 'recovered'`. PR1 does not
  invent or reconstruct history.
- **Live session:** session 22 (conversation 13596) stays pinned to revision 2 through
  all of this.

## 16. Disable semantics

**Deferred from PR1.** PR1 adds no enable/disable or unpublish. The existing,
non-destructive controls remain:
- **The owner's master switch** (`agencies.autoResponseEnabled`) and **the channel switch**
  (`auto_response_settings.enabled`).
  - Turning either off stops new questionnaires.
  - An active session is wound down by the worker on its next turn: it is handed to a
    person with its answers (`engine_disabled`). It is never handed to the AI.
- **Staff `configure.ts --disable`** (`responder → 'agent'`).

None of them deletes a revision, a draft or a session. Mobile V1's switch will drive
these same controls in a later PR.

---

## 17. Perfect Picture walkthrough (revision 4 → 5, change the wedding URL)

1. `getQuestionnaireBuilderState()` → `published.revision = 4`; `draft = null`;
   `activeSessionsByRevision = [{ revision: 2, count: 1 }]` (session 22).
2. `openQuestionnaireDraft()` → `draftId = D`, `draftVersion = 1`, `baseRevision = 4`.
   The questionnaire is revision 4 in Builder form:
   - question `event_type` is `single_choice` with 7 options; each has its `label`,
     `icon` and `phrasings`;
   - `event_date_celebration` has `answer = { kind: 'date', notSetAllowed: true }` and
     `shownWhen = { mode: 'all', conditions: [{ questionId: 'event_type', anyOf: ['wedding','bar_bat_mitzvah','brit','henna'] }] }`;
   - `endings.custom[2] = { when: { … anyOf: ['wedding'] }, message: '…wisepage…' }`.
3. The owner edits the wedding ending's link →
   `saveQuestionnaireDraft({ draftId: D, expectedVersion: 1, questionnaire })` →
   `draftVersion = 2`. Ids unchanged. Revision 4 row untouched; `settings.questionnaire`
   untouched.
4. `simulateQuestionnaireDraft({ draftId: D, turns: [['היי'], ['אנחנו מתחתנים'], ['18.11.2026'], ['רחובות'], ['סטילס']] })`:
   - the explanation at turn 2 shows wedding recognised from "אנחנו מתחתנים", next
     question the date;
   - the final reply contains the **new** link;
   - the summary is clean.
5. `checkQuestionnaireDraft({ draftId: D })` → `ready: true`.
6. `publishQuestionnaireDraft({ draftId: D, expectedVersion: 2 })` → `revision: 5`.
   - Row D is now published revision 5, immutable.
   - `settings.questionnaire` becomes revision 5.
   - Session 22 (revision 2) and any revision 4 session are untouched.
7. An existing revision-4 session continues on revision 4: `processJob` reads its frozen
   snapshot (`9dee7e0c` behaviour). A new conversation's `startSession` freezes the
   current definition, which is revision 5.
8. Proven by the pinning DB test through the same worker path. No SQL, no script, no
   deploy.

## 18. Beauty salon walkthrough (new agency, never configured)

1. `getQuestionnaireBuilderState()` → `published: null`, `draft: null`,
   `live.responder: 'agent'` (no settings row).
2. `openQuestionnaireDraft()` → an empty skeleton draft: standard ending, handoff
   message, 2 attempts, 24 hours, no questions. It is incomplete, which is allowed for a
   draft.
3. `saveQuestionnaireDraft` with the Builder model below. No engine terms are used
   anywhere: no `validate`, `allowNotSet`, `when`, `aliases` or ids.

   ```
   opening: 'שלום, נשמח להכיר אותך'
   questions: [
     { label: 'טיפול', prompt: 'איזה טיפול מעניין אותך?', shownWhen: { mode: 'always' },
       answer: { kind: 'single_choice', options: [ { label: 'איפור', phrasings: [] }, { label: 'שיער', phrasings: [] }, { label: 'איפור ושיער', phrasings: [] } ] } },
     { label: 'תאריך', prompt: 'לאיזה תאריך?', shownWhen: { mode: 'always' },
       answer: { kind: 'date', notSetAllowed: true } } ]
   endings: { standard: 'תודה! נחזור אלייך בהקדם', custom: [] }
   ```

   The server assigns `q_…` and `o_…` ids and returns `issues: []`.
4. `checkQuestionnaireDraft` → `ready: true`.
5. `simulateQuestionnaireDraft({ turns: [['היי'], ['שיער'], ['עדיין לא נקבע']] })` →
   - opening + menu;
   - the date question;
   - the closing;
   - summary `תאריך: טרם נקבע`.
6. `publishQuestionnaireDraft` → `revision: 1`.
   - **No settings row is created and routing is untouched**, so nothing customer-facing
     starts.
   - A future activation flow copies the current revision into settings and switches
     routing.

---

## 19. Migration plan (recommended; not created, not executed)

- **File:** `migrations/<timestamp>_questionnaire_revisions.cjs`, additive. Never use
  the colliding `20260916000001/2` timestamps.
- **`up()`:**
  1. `CREATE TABLE questionnaire_revisions` (§2.3) with the check constraint.
  2. `CREATE UNIQUE INDEX … ("agencyId", channel, revision)`.
  3. `CREATE UNIQUE INDEX … ("agencyId", channel) WHERE status = 'draft'`.
  4. Index `("agencyId", channel, status)`.
  5. `CREATE FUNCTION questionnaire_revisions_immutable()` + `BEFORE UPDATE OR DELETE`
     trigger: raise when `OLD.status = 'published'`.
  6. Backfill `INSERT … SELECT` (§15).
- **`down()`:** drop the trigger, function and table. The runtime never reads the
  table, so rollback is safe.
- **Process** (`release-deployment-workflow.md` §8b):
  1. CI schema check: baseline → all migrations → reversible.
  2. Read-only production pre-check (list and parse the rows to backfill).
  3. Apply `npm run migrate` manually **before** the deploy.
  4. Record batch + filename.
  5. Then deploy PR1.
- **Post-check:** count published rows = count of non-null `questionnaire`; per agency,
  `settings.questionnaire.revision = max(revision)`.

## 20. File-by-file implementation plan

| File | Change |
| --- | --- |
| `migrations/<ts>_questionnaire_revisions.cjs` | new (§19) |
| `db/questionnaireRevisions.ts` | new: `getDraft`, `getPublished`, `getLatestPublished`, `listPublished`, `insertDraft`, `updateDraftVersioned`, `deleteDraftVersioned`, `publishDraftTx` (§12), `countActiveSessionsByRevision`. Every function takes `agencyId` |
| `lib/inbox/autoresponse/questionnaire/builder/model.ts` | new: Builder types + lenient `builderDraftSchema` |
| `…/builder/convert.ts` | new: `toBuilder` / `toDefinition` (answer kinds, `shownWhen` ↔ `when`, endings ↔ `closing` + `closingVariants`, phrasings ↔ aliases) |
| `…/builder/ids.ts` | new: `assignIds` (§8) |
| `…/builder/checks.ts` | new: publish validation = runtime zod → `BuilderIssue` codes + referential checks (§9) |
| `…/builder/view.ts` | new: `describeQuestionnaire` (three concepts + routes), built on `render.ts` |
| `…/builder/simulate.ts` | new: replay on shared functions (§10) |
| `…/builder/skeleton.ts` | new: empty-draft defaults (Hebrew standard ending/handoff) |
| `lib/inbox/autoresponse/questionnaire/turnState.ts` | new, extracted: `nextSessionState` |
| `lib/inbox/autoresponse/questionnaire/processJob.ts` | modified: use `nextSessionState` (behaviour-neutral; stays ≤ 350 lines) |
| `actions/questionnaire/builderDraft.ts` | new: `getQuestionnaireBuilderState`, `openQuestionnaireDraft`, `saveQuestionnaireDraft`, `discardQuestionnaireDraft`, `checkQuestionnaireDraft` |
| `actions/questionnaire/builderPublish.ts` | new: `simulateQuestionnaireDraft`, `publishQuestionnaireDraft`, `listQuestionnaireRevisions`, `getQuestionnaireRevision` |
| `lib/flags/questionnaireBuilderFlags.ts` | new: `canUseQuestionnaireBuilder` (absence blocks) |
| `scripts/questionnaire/configure.ts` | modified: `--enable` via `publishDefinition(source: 'staff')`; `--show` lists revisions; refuses over an owner draft unless `--discard-draft` |

No change to the worker, the runtime read path, `startSession`, the settings form or
any UI.

## 21. Test plan

**Unit:**
- **Conversion round-trip:** `toDefinition(toBuilder(d))` deep-equals `d` for the 158
  revision 4 production definition, 103's pilot, and every sample.
- **Answer kinds:** each one maps both ways.
- **`shownWhen`:** 0/1 conditions compile; more than 1 gives the publish issue.
- **Ids:** rename keeps id; copy creates new ids; unknown id rejected; format and
  uniqueness hold; semantic ids preserved.
- **Draft schema:** incomplete drafts accepted; structural violations rejected.
- **Publish checks:** every runtime error class maps to a code with ids (deleted option
  still referenced, phrasing on two options, ending on a deleted option, too long,
  unreachable, wrong order); warnings don't block.
- **View:** each question type yields the three concepts; `customerSees` equals
  `renderQuestion`.
- **Simulator:** the Perfect Picture and salon walkthroughs; explanation fields; the
  `not_ready` guard.

**DB (serialized, local test database):**
- **Draft isolation:** saves leave the published rows, `settings.questionnaire`,
  sessions and other agencies byte-identical (fingerprints).
- **Immutability:** UPDATE/DELETE on a published row fails (trigger).
- **Publish:** creates *N+1* and updates settings atomically. Injected failures (invalid
  draft; settings write failure) leave nothing changed and the draft still a draft.
- **Idempotency:** `Promise.all` of two identical publishes → one revision; the other
  returns `alreadyPublished`.
- **Concurrency:** two saves at the same version → exactly one `version_conflict`;
  `draft_out_of_date` after a staff publish; concurrent open returns one draft.
- **Pinning through the real worker:** a session started on *N* finishes on *N* after
  *N+1* is published; a new conversation starts on *N+1*.
- **Tenancy:** agency X cannot get, save, discard, check, simulate or publish agency Y's
  draft or revision (`not_found`); a non-admin is `forbidden`; flag absent is
  `forbidden`.
- **New agency:** publish creates a settings row with `enabled = false`; the runtime
  sends nothing.
- **Migration:** on a fresh database (baseline + migrations) the backfill creates rows
  for 103- and 158-shaped settings, and the invariant holds; `down()` is clean.
- **Staff path:** `configure.ts --enable` writes a `source = 'staff'` revision.
- **Simulator parity corpus vs the real worker** (§10).

**Regression:** the full questionnaire unit and DB suites, ownership suites and opt-out
consumers, `tsc`, `next build`.

## 22. Risks

| Risk | Mitigation |
| --- | --- |
| A writer bypasses publish and diverges `settings.questionnaire` from the history | One writer path (the publish service; `configure.ts` routed through it); invariant test; post-migration check |
| The `processJob` refactor changes runtime behaviour | Pure extraction; all existing worker, race, pinning and ownership DB suites must pass unchanged |
| The conversion is lossy for a future runtime field | Round-trip test on all real definitions fails loudly when a field is added without a Builder counterpart |
| The simulator diverges from production | Shared functions only; the parity corpus runs both paths |
| Publishing for a new agency surprises the settings page | Resolved by design: publish creates no settings row. Tested through the page's real read path (`getMasterEnabled` / `getChannelSettings`) and the mobile component |
| Publish reactivates an agency staff switched back to the agent | Resolved by design: publish never writes `responder`; tested for all three cases |
| A trigger in the schema | Included in the CI schema check; `down()` drops it |
| Self-service publish to agencies outside the runtime gate | Publishing never bypasses `WA_QUESTIONNAIRE_AGENCY_IDS`; the Builder has its own absence-blocks flag |

## 23. Ready to implement PR1

**YES**, once Option B (§3) is approved. The migration is the only part that needs
explicit approval under CLAUDE.md §4 and `do-not-touch.md` §2.
