# First-Party Option Sources in the Automation Builder — Audit

**Status:** audit. No implementation.
**Question:** should `quoteTemplateId` be resolved by a dedicated component, or does the
Builder need a small reusable first-party option-source primitive?
**Predecessor:** [quotations-automation-phase-b-audit.md](quotations-automation-phase-b-audit.md) §4.1/§5.2,
which recommended the dedicated component. **This audit reverses that recommendation** — see §7.

---

## 1. How remote options flow today

### 1.1 The trace, catalog → Builder → Server Action → options

```
CATALOG            ParameterDefinition { type: 'enum_remote', optionSource: 'whatsapp_templates' }
                   lib/automations/catalog/entries/{events,actions}.ts
                        │
                        │  optionSource is INERT metadata: never persisted, never parsed by
                        │  the engine, only forwarded to a resolver. The chosen VALUE is what
                        │  is persisted (content.templateId / sourceIds).
                        ▼
BUILDER            two entirely separate render paths ─────────────────────────────┐
                        │                                                          │
   EVENT parameters ────┤                                    ACTION parameters ────┤
   AutomationTriggerSection                                  AutomationActionSection
        → RemoteParameters                                        → AutomationTemplateSection
          (the ONLY caller of RemoteParameters)                     (bespoke, per shape)
        │                                                          │
        ▼                                                          ▼
SERVER ACTION      listOptionsAction(connectionId, source)   listOptionsForCapabilityAction(capability, source)
                        │                                          │  connectionsForCapability → connections[0]
                        └──────────────────┬───────────────────────┘  → listOptionsAction(connection.id, …)
                                           ▼
CONNECTION LAYER   optionsFor(providers, agencyId, connectionId, optionSource)
                     → providerForConnection(connectionId)      // splits "integrationKey:stable-id"
                     → provider.options(agencyId, connectionId, optionSource)
                     → safe(): a throwing provider answers []   // never an error
```

### 1.2 Every consumer of `type === 'enum_remote'`

Exhaustive — five, and they do not agree about what the type means:

| # | Consumer | What it assumes |
| --- | --- | --- |
| 1 | [`binding.ts` `sourceIdsFrom`](lib/automations/binding.ts) | an **event's** answer names a connector **Source**, and writes it into `sourceIds` — the connection binding |
| 2 | [`binding.ts` `needsConnection`](lib/automations/binding.ts) | an event carrying one **requires a connection** before it can be configured |
| 3 | [`validate.ts`](lib/automations/catalog/validate.ts) | requires `optionSource`; forbids `optionSource` on any other type |
| 4 | [`RemoteParameters.tsx`](components/settings/automations/RemoteParameters.tsx) | resolution needs a `connectionId`; without one it renders *"יש לבחור חיבור כדי להציג את האפשרויות"* and fetches nothing |
| 5 | [`connectors/types.ts`](lib/automations/connectors/types.ts) | the provider contract is `options(agencyId, connectionId, optionSource)` — a connection id is structural |

### 1.3 Two facts that decide most of this audit

**Fact A — action parameters never touch `RemoteParameters` or `sourceIds`.**
`RemoteParameters` has exactly one caller: `AutomationTriggerSection`, for **event** parameters.
`sourceIdsFrom` reads `event.parameters` only. So `whatsapp.send`'s `templateId` — an
`enum_remote` on an *action* — is resolved entirely by a bespoke component
(`AutomationTemplateSection` + `listOptionsForCapabilityAction`) and never enters the binding.
The dedicated-component pattern is not an exception; on the action side **it is the only pattern
that exists**.

**Fact B — first-party agency data is ALREADY being served through the connection layer.**
[`connectors/whatsapp.ts:127`](lib/automations/connectors/whatsapp.ts#L127):

```ts
if (optionSource === 'whatsapp_templates') {
  const { listTemplates } = await import('@/db/whatsappTemplates')
  const templates = await listTemplates(agencyId)
  return templates.filter((t) => t.status === 'approved').map(…)
}
```

That is a **local, agency-owned table**. The connection is used only to *route* to the provider;
the data never leaves our database and the `connectionId` argument is unused by the query.

*Stated fairly:* for WhatsApp the capability gate carries real meaning — a message template is
meaningless without an approved WABA, so `[]` when disconnected is the correct answer, not an
accident. It is nonetheless first-party data reaching the Builder through the only door that
existed. Quote templates are the same shape **without** a capability that could gate them.

---

## 2. Can `enum_remote` safely support first-party agency data?

**Yes as a mechanism, no as a bare type.** The `optionSource` string is inert, so nothing in the
persistence or engine layers objects. Three of the five consumers, however, would misread it:

| Consumer | What breaks for a first-party parameter |
| --- | --- |
| `RemoteParameters` | gated on `connectionId`. On an event with no connection it shows *"choose a connection"* forever and never fetches. |
| `sourceIdsFrom` | an **event** first-party answer would be written into `sourceIds` as though a quote-template id were a connector Source — corrupting the binding record. |
| `needsConnection` | would report an event as requiring a connection it does not need, blocking configuration on a gate that can never be satisfied. |
| resolution doors | both end at `providerForConnection(connectionId)`. No connection ⇒ no provider ⇒ `[]`, **silently** — `safe()` swallows, so a misconfiguration is indistinguishable from "you have no templates". |

The last row is the one that matters most operationally: the failure mode is an **empty dropdown
with no diagnostic**, which is exactly the "no silent failures" rule the Connection layer was built
around.

Note that for an *action* parameter, rows 2 and 3 do not apply (Fact A). So a first-party action
parameter declared as bare `enum_remote` would not corrupt anything today — it would simply never
resolve through the generic door. The danger is latent rather than immediate: the first first-party
**event** parameter would hit rows 2 and 3, and nothing in the catalog or CI would warn.

---

## 3. The smallest clean extension — and why the brief's shape is the wrong one

The brief proposed:

```ts
optionSource: { kind: 'first_party', key: 'quote_templates' }
```

**This is the more expensive and less safe of the two available discriminators.** It keeps
`type: 'enum_remote'`, so every consumer that branches on the type still matches and must each
learn a new distinction:

| Change needed | `optionSource` object | new parameter **type** |
| --- | --- | --- |
| `sourceIdsFrom` must exclude first-party | **yes** — inside the connection-binding code | **no** — filters `type === 'enum_remote'`, simply does not match |
| `needsConnection` must exclude first-party | **yes** | **no** — same reason |
| `validate.ts` | accept both shapes on one type | one mirrored rule for the new type |
| `optionSource: string` signature | becomes a union; 4 call sites doing `p.optionSource ?? ''` become type errors, incl. `ConnectorContract.options(…, sourceKey: string)` | **unchanged** |
| `RemoteParameters` | branch on the object's kind | one added branch |

**The decisive property:** with a new type, a first-party parameter is *structurally incapable* of
reaching the connection binding — `binding.ts` needs no edit at all, and cannot be got wrong.
With the object discriminator, the code that binds automations to connections must be taught a
distinction it currently does not have. That is the last module in this subsystem one would choose
to make conditional.

So the smallest clean extension is a **vocabulary append**, not a shape change:

```
PARAMETER_TYPES  += 'enum_agency'          // one value, append-only, for everyone
validate.ts       : enum_agency requires optionSource   (mirrors enum_remote)
firstPartyOptions : optionSource → (agencyId) => ConnectionOption[]   — one registry, one entry
listAgencyOptionsAction(optionSource)      // guarded; no connectionId
RemoteParameters  : render enum_agency via that action
```

`PARAMETER_TYPES` is explicitly append-only and the vocabulary header states these sets *"grow for
everyone or not at all"* — Law 4 forbids an *integration* adding a type, which this is not. It is
nonetheless a deliberate act on a closed vocabulary and should be done **once**, with a conformance
test, not repeated per data kind.

**Not a dynamic-form framework.** One appended type, one lookup table, one server action. Nothing
becomes data-driven that is not already.

---

## 4. Option A vs Option B

**A — dedicated:** `AutomationQuoteSection.tsx` → `listQuoteTemplateOptionsAction` → `listQuoteTemplatesSystem`
**B — primitive:** `enum_agency` + registry + one generic action + `RemoteParameters` branch

| Axis | A — dedicated | B — primitive |
| --- | --- | --- |
| **Code size** | ~45-line component + an `AutomationActionSection` branch (~8) ≈ **55 lines** | 1 vocabulary line + ~4 validation + ~20 registry + ~15 action + ~15 renderer + ~10 wiring ≈ **65 lines** |
| **Duplication** | third bespoke picker after `AutomationTemplateSection` and `AutomationTitleSection`; each re-implements fetch/loading/empty | one renderer for every future first-party picker |
| **Type safety** | fine, but the branch keys on the parameter **name** `quoteTemplateId` — a per-action string | branch keys on the parameter **type** — a closed vocabulary value |
| **Catalog discoverability** | **the real cost.** Declaring `type:'enum_remote', optionSource:'quote_templates'` passes `validateCatalog` and asserts something false — the generic door returns `[]` for it. Avoiding the lie means declaring it `type:'number'`, which discards the "this is a selection" semantic the catalog exists to carry | the declaration is true: the type says where the options come from and a generic resolver honours it |
| **Future reuse** | none — instance four repeats the work | free |
| **Testing** | component test + an action test | registry conformance (`every optionSource has a loader`), plus the existing catalog validation covers the type |
| **Architecture complexity** | zero new concepts, but grows the count of per-action Builder branches — the thing the Builder is repeatedly designed to avoid | one new concept in a place designed to receive it |
| **Migration risk** | zero | zero — catalog-only; `optionSource` stays a string, no persisted value changes, no engine file changes behaviour for existing rows |

**Sizes are comparable.** "Smallest" does not decide this.

---

## 5. Future-proofing — is Quote a one-off?

Evidence from the current tree, not speculation:

| First-party agency data | Exists today | Plausible as an automation parameter |
| --- | --- | --- |
| **WhatsApp templates** (`whatsapp_templates`) | **already an option source** — via the connection door, reading a local table | shipped |
| **Quote templates** (`sales_quote_templates`) | built and verified; `listQuoteTemplatesSystem` exists | the case at hand |
| Task templates (`getTaskTmplts`) | yes | "create a task from template" — a natural sibling of the shipped `task.create` |
| Reps / users (`getUsers`) | yes | "assign the lead to נציג X" |
| Teams (`user_teams`) | yes | routing by team |
| Promotions (`db/promos.ts`), lead lists | yes | plausible, unevidenced |

Correctly **excluded**: lead statuses are already catalog `enum` field options
(`LEAD_STATUS_OPTIONS` in `entries/events.ts`) — a closed product vocabulary, not agency data.
Automation marketplace templates are static catalog entries, not agency rows.

**Verdict: Quote is the second instance, not the first.** One is already in production wearing the
connection layer's clothes; a third and fourth are ordinary near-term asks. That is a missing
primitive, not a special case.

---

## 6. The critical invariant

> ONE source of truth for selectable quote templates; archiving removes a template from **both**
> Builder selection and executor preflight; editing never alters an existing quote.

**Satisfied today, under either option**, because both doors already terminate in the quote domain:

```
Builder    → (A: listQuoteTemplateOptionsAction | B: listAgencyOptionsAction)
                                    ↓
                        listQuoteTemplatesSystem(agencyId)     ← active-only
Executor   → getQuoteTemplateSystem(agencyId, templateId)      ← active-only + non-empty
```

Two functions, not one — and that is correct: a picker needs the list, a preflight needs one row
with its items. What matters is that they **agree about archived**, and they do: `state !== 'active'`
returns `null` in `getQuoteTemplateSystem`, and the list query filters `state: 'active'`.

Verified in the template-management phase (29/29 DB checks), specifically:

- `ARCHIVE: removed from the selection primitive`
- `ARCHIVE: refused as a source for NEW quotes`
- `THE INVARIANT: editing the template does NOT change the existing quote` — ₪4,900 quote unchanged
  after the template moved to ₪5,500

**One gap to close when either option is implemented:** nothing currently *pins* that the two
functions agree about archived. A conformance test asserting "every id returned by
`listQuoteTemplatesSystem` is loadable by `getQuoteTemplateSystem`, and no archived id is returned
by either" would make the invariant enforced rather than merely true.

Neither option affects this. It is an argument about *where the Builder's list comes from*, not
about what it contains.

---

## 7. Recommendation

> ## Add a small first-party option-source primitive first.

**This reverses [quotations-automation-phase-b-audit.md](quotations-automation-phase-b-audit.md) §5.2**,
which recommended the dedicated component. Two things changed between that audit and this one:

1. `listQuoteTemplatesSystem` now exists and is verified, so the domain half of either option is
   already done — which removes the "ship the smaller thing first" advantage A had.
2. Reading `connectors/whatsapp.ts` closely showed that **first-party agency data already flows
   through the connection layer** (Fact B). At the time of the Phase B audit I treated the
   connection-scoped resolver as genuinely connection-shaped. It is not: for `whatsapp_templates`
   it is a local table read, routed through a connection id it does not use.

**Why B, in order of weight:**

1. **Not speculative.** The repo's own principle is to optimise from evidence, not anticipation —
   and the evidence is a shipped instance (`whatsapp_templates`), a built second instance (quote
   templates), and three plausible near-term ones. Two instances plus a working precedent is a
   pattern, not a forecast.
2. **A has a correctness cost, not a taste cost.** Declaring the parameter `enum_remote` makes the
   catalog assert a resolution path that returns `[]`. Declaring it `number` discards the selection
   semantic. Neither is neutral, and the catalog's whole value is that its declarations are true.
3. **The type discriminator is strictly safer than the alternatives.** `binding.ts` — the module
   that binds automations to connections — needs **no change at all**, and a first-party parameter
   becomes structurally unable to corrupt `sourceIds`. Both the brief's `optionSource` object and
   the bare-`enum_remote` route would require that module to learn a new distinction.
4. **Size does not favour A** (~65 vs ~55 lines), and B *removes* a bespoke component instead of
   adding the third one.
5. **Migration risk is zero either way** — catalog metadata only, no persisted value changes, no
   behaviour change for any existing automation.

**Conditions on doing it:**

- **Once, deliberately.** Appending to `PARAMETER_TYPES` is an act on a closed vocabulary. It ships
  with a conformance test pinning that every registered `optionSource` has a loader and every loader
  is reachable — the discipline `executors.test.ts` already applies to the executor registry.
- **One type, one registry, one action.** Not a dynamic-form framework; nothing becomes data-driven
  that is not already.
- **Ship it as its own change, before `quote.create`**, with the automation suite's pre-existing
  failure count unchanged — so the vocabulary change is verifiable in isolation rather than tangled
  with a new action.
- **Do not migrate `whatsapp_templates` to it.** Its capability gate is meaningful and its current
  path works; moving it would be a behaviour change for a shipped action, for tidiness. Leave it.

**If you would rather not touch the vocabulary at all**, Option A is defensible and unblocks
`quote.create` — but then declare the parameter honestly (not `enum_remote`), accept the third
bespoke picker, and expect to revisit this at the next first-party picker.

---

## Appendix — what this audit did NOT change

No code written. No automation engine file modified. No quote domain change. No billing change.
The invariant in §6 is already satisfied and independently verified; nothing here alters what the
Builder or the executor would resolve, only where the Builder's list is fetched from.
