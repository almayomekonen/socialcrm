# architecture-rules.md — File Size, Component, and Logic Rules

**Status:** binding for all new work. Applies retroactively when a file is touched.

The cost of a 700-line component is not its length — it's the impossibility of
reviewing, testing, or refactoring it without holding the whole thing in mind.
These rules exist to keep code reviewable by a tired human at 6pm on a Friday.

---

## 1. FILE SIZE RULES

- **Soft limit: 250 lines.** When a file crosses this, a follow-up extraction is required next time the file is touched. Don't fight to stay just under; extract proactively.
- **Hard limit: 350 lines.** Files MUST NOT cross this without an extraction plan agreed in the same change.
- **Never allow files to grow toward 500–700+ lines.** A file over 500 lines is a code smell, not a code review concern. Treat it as a defect.
- **When approaching either limit:**
  - Split before continuing the current feature work.
  - Do not postpone splitting "until after the current feature."
  - Postponed splits never happen.

The line count is a proxy for cognitive load. A 200-line file with three concerns is worse than a 400-line file with one. But the line count is a forcing function that surfaces the underlying problem.

---

## 2. COMPONENT RULES

**Components have one responsibility.**

A component is a single concern made visible. When you can name it without using
"and," "with," or "or," it's probably the right size.

### Bad — one component absorbs everything

```
InvoiceNewEditor.tsx
  - issue flow orchestration
  - modal state management (4 modals)
  - sessionStorage autosave
  - form state for 4 fields
  - API call wiring
  - validation
  - layout rendering
  - sticky action bar
  - customer picker (combobox)
  - PDF logic
```

This is a controller monster. It can't be tested. It can't be refactored
without breaking three other concerns. Each change risks a regression in
an unrelated area.

### Good — one orchestrator, many focused components and hooks

```
InvoiceNewEditor.tsx          ← thin orchestrator (~150 lines max)
  ├─ uses hooks/useIssueFlow.ts
  ├─ uses hooks/useTransientDraftAutosave.ts
  ├─ renders <InvoicePageHeader/>
  ├─ renders <RecipientCard/>          (which uses <LeadPicker/>)
  ├─ renders <InvoiceLinesEditor/>
  ├─ renders <InvoiceMetadataDetails/>
  ├─ renders <InvoiceTotalsSummary/>
  ├─ renders <InvoiceActionBar/>
  └─ renders <IssuerIdentityModal/>, <IssuerSetupRequiredModal/>, <ConfirmPop/>
```

Each sub-component:

- Has one job.
- Has clear props (data in, callback out).
- Can be tested in isolation.
- Can be reused in the draft editor / future surfaces.

### Naming guidance

- A component name that says "and" is two components: `EditorAndPicker` → split.
- A component name ending in "Controller," "Manager," or "Orchestrator" should be reserved for the top-level thin file. Multiple such files in the same folder is a smell.

---

## 3. LOGIC RULES

**Move logic out of UI files.**

UI files render. They do not decide, fetch, transform, validate, or coordinate.
Stack-rank where logic should live:

```
hooks/      ← stateful logic with effects (autosave, polling, async flows)
lib/        ← pure logic (validation, formatting, calculations, registries)
actions/    ← server-side mutations + reads via server actions
db/         ← knex queries, raw data access
helpers/    ← small pure utilities shared across the above
```

If you find yourself writing five `if/else` branches inside a JSX component, the
branches probably belong in a hook or a pure function. The component renders
the decision; it doesn't make it.

### Bad — branching cluster inside JSX

```tsx
async function handleClick() {
  if (busy) return
  if (!data) return
  if (data.kind === 'A') { … }
  else if (data.kind === 'B') { … }
  else if (data.kind === 'C') { … }
  setSomething(true)
}
```

### Good — branching encapsulated in a hook

```tsx
const { state, handlers } = useIssueFlow()
// component just renders based on `state`
```

The component shows what state we're in. The hook decides how we got there.

---

## 4. WHEN TO SPLIT — PROACTIVE TRIGGERS

Split a component BEFORE the limit hits when ANY of these are true:

- The component manages **3+ unrelated modal states**.
- The component has **3+ async handlers** for different actions.
- The component renders **3+ visually-distinct sections** that don't share state.
- The component has **2+ `useEffect` hooks** doing different things.
- The component imports **5+ server actions**.

A component crossing any two of these is already too big, regardless of line count.

---

## 5. EXTRACTION PROCESS

When a file needs splitting:

1. **Identify responsibilities.** List them. If you can't articulate them, you don't understand the file yet.
2. **Group by data ownership.** What state belongs to which responsibility?
3. **Lift state.** Move state into hooks or to the orchestrator. Sub-components receive props.
4. **Move logic before UI.** Hooks first, then components consume them.
5. **Verify by line count.** No new file should exceed the soft limit. No new file should require a comment explaining "this is temporary, will split later."

After splitting:

- The orchestrator should fit on one screen.
- Each sub-file should be glanceable in 30 seconds.
- Reading any sub-file alone should produce a complete understanding of THAT concern.

---

## 6. WHEN THIS RULE IS NOT THE ANSWER

Splitting is not free. A 350-line file with one concern, no nested state, and clear linear flow may be **fine**. The rules are a forcing function for the common case, not a religion.

Exceptions require explicit acknowledgment in the file's header comment:

```
/**
 * NOTE: This file is 380 lines and intentionally so. The PDF
 * renderer is one linear top-to-bottom drawing sequence; splitting
 * it would require passing 12 props between micro-components for
 * no readability gain.
 */
```

No silent exceptions. If a file is over the soft limit and not extracted, the file itself must state why.

---

## 7. GROWTH ZONE RULE (200 line warning band)

Files between ~200 and the 250 soft limit are in the **growth-risk zone**. They do NOT need splitting today, but the next change is the moment to evaluate:

- **Responsibility review before adding new logic.** Re-read the file. If the addition belongs to a different concern, put it somewhere else from the start.
- **Check if additions belong elsewhere.** A new helper function, a new state, a new branch — does it fit the file's current single responsibility? If not, extract a sibling.
- **Avoid using growth-zone files as dumping grounds.** "I'll just add it here for now" is how 200-line files become 700-line files.

Examples in the codebase post-Phase-1d:

- `components/billing/lead-picker/LeadPicker.tsx` (~230 lines) — acceptable today, single responsibility (combobox + portal panel). Next addition (search-result virtualization, keyboard nav, etc.) should prompt: "does this belong in LeadPicker, or should it be a sibling?"
- `components/billing/issuer/IssuerFieldRenderers.tsx` (~215 lines) — acceptable today, single responsibility (per-input-type rendering). Next inputType added to the registry: render it here. Next time someone adds business logic to a renderer: extract.

The rule's purpose is to **catch the silent slide** from "focused file" to "controller monster" before it happens. A 220-line file with one job is healthy. A 220-line file accumulating its third unrelated concern is on the path to 700.

When in doubt: treat the next edit as a checkpoint, not a license.

---

## 8. ENFORCEMENT

These rules apply:

- To all new files going forward.
- To all existing files when they are touched (the touch is the trigger).
- During code review: any PR that adds lines to a file already over the soft limit must include an extraction plan or a documented exception.

When in doubt: split. Files are cheap. Cognitive load is expensive.

---

## 9. BUSINESS-DAY CLASSIFICATION — SINGLE SOURCE OF TRUTH

**Status:** binding. Business-day concepts — "today", "overdue", "due today",
"from this morning", and the like — MUST have one implementation, and it is
`lib/time/businessDay.ts`.

This rule exists because a duplicated business-day calculation caused a
production `/dashboard` crash (React #418): the urgency label was computed
independently on the server and the client, the Vercel server runs in **UTC**
while the browser runs in **Asia/Jerusalem**, so the two disagreed on the day
boundary and rendered different HTML — a hydration mismatch that is fatal in the
production build.

### Rules

- **One source of truth.** Every business-day boundary/classification goes
  through `lib/time/businessDay.ts` (`startOfBusinessDay`, `isBeforeBusinessDay`,
  `classifyUrgency`). Never re-derive a day boundary inline
  (`new Date().setHours(0, 0, 0, 0)`, a local `startOfDay`/`startOfToday`, etc.) —
  extend the helper instead.
- **Never compute the same classification on both sides.** A business-day value
  is computed exactly once — on the **server** — and passed down as data. Server
  and client must never each run the logic and hope they agree.
- **Canonical timezone, not the device.** The business day is defined in
  `BUSINESS_TZ` (currently `'Asia/Jerusalem'`), never the browser's local
  timezone. "Overdue/today" is a business-day question, so it follows the
  business's day regardless of where the rep's browser is. `BUSINESS_TZ` is the
  single place to change if this ever becomes per-agency.
- **DST-aware, never a fixed offset.** The helper derives the boundary via the
  `Intl` API against `BUSINESS_TZ`. Do not hardcode `+2`/`+3` or assume a fixed
  UTC offset.
- **Client Components render, they don't classify.** A Client Component MUST NOT
  call `Date.now()`, `setHours()`, or any business-day logic during render. It
  receives the precomputed label/tone/flag as a prop and renders it.

### Why

A deterministic, timezone-explicit computation done once on the server is the
only way server-rendered HTML and client hydration can agree. `businessDay.ts` is
verified deterministic across Node/browser, process timezone, and locale, and is
covered by DST unit tests; routing every business-day concept through it is what
keeps the mismatch from recurring — in the dashboard or anywhere else.
