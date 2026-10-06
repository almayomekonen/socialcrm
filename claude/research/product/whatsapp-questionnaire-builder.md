---
domain: product
status: proposed
last_updated: 2026-10-06
related: []
---

# WhatsApp Questionnaire Builder

**Question:** How does a business owner build the deterministic WhatsApp
questionnaire themselves, without staff, and without learning the engine?

**First-class constraint (Creative Director, 2026-10-06):** the Builder must be
extremely intuitive for a first-time owner and still expose the full power of the
engine. The owner should feel *"I'm building the WhatsApp conversation my customers
will experience"*, not *"I'm configuring a workflow engine"*. This constraint carries
the same weight as runtime correctness. Every recommendation below is checked against
it, and against one principle:

> **Simple things should be obvious. Powerful things should be possible.**

**Scope.** This document covers the authoring experience and the authoring
architecture. The runtime is NOT redesigned. It is already shipped and proven in
production (Perfect Picture, agency 158, revision 4, `9dee7e0c`). The Builder is a
translation layer on top of it.

---

## 1. Observation

### 1.1 What exists today

- **There is no questionnaire editing UI anywhere.** On desktop, the owner sees an amber
  read-only notice (`components/settings/autoResponse/QuestionnaireModeNotice.tsx`):
  *"the questionnaire is configured by SocialCRM staff — contact us to change it"*. On
  mobile (`modules/settings/mobile/AutoResponseMobile.tsx`) they see a warning and the
  master switch.
- **Today every questionnaire is authored by staff.** Staff write JSON, then run
  `scripts/questionnaire/configure.ts` (dry run, then `--enable`) against production. Perfect
  Picture went through four revisions this way in one day. Each revision needed an
  engineer, a dry run, a semantic diff, a database fingerprint and a read-back. That
  is the cost the Builder exists to remove.

### 1.2 The runtime the Builder must be able to drive

All of this is shipped and verified in production. In engine terms:

| Capability | Engine form |
| --- | --- |
| Opening, per-question prompt, closing, handoff text | `welcome`, `steps[].prompt`, `closing`, `handoff` |
| Single choice, multi choice, free text | `type: choice` / `choice + multi` / `text` |
| Natural recognition of a choice | `options[].aliases` (whole words, Hebrew prefixes, negation-safe, never guesses between two options) |
| Presentation icon per option | `options[].icon`. Display only; never matched, stored or shown to the rep |
| Conditional question | `steps[].when = { step, anyOf: [options] }`. May only refer to an earlier choice question |
| Conditional closing (different text or link per route) | `closingVariants[] = { when, text }`; first match wins |
| Answer checking | `validate: 'date' \| 'meaningful'` |
| "Not decided yet" as a real answer | `allowNotSet` → stored as `not_set`; the rep sees "טרם נקבע" |
| Custom re-ask / re-ask without the greeting | `invalidPrompt`, `reaskPrompt` |
| Attempts before handing to a person, abandonment window | `maxInvalidAttempts`, `expireAfterHours` (questionnaire-wide) |
| Safety, not configurable by design | נציג → person; opt-out; owner takeover wins; customer questions acknowledged; one message = one answer; nothing silently lost; corrections flagged; sessions pinned to their revision |

### 1.3 The four revisions of Perfect Picture are the Builder's specification

Every one of them was a request from a business owner, in business language:

| Owner asked (2026-10-06) | Engine change staff had to make |
| --- | --- |
| "They should be able to write naturally, not the exact label" | aliases on every option |
| "Drone needs its own questions" | `when` on six questions; a second route |
| "Website only for bar mitzvah, henna and drone; wedding gets a different link" | three `closingVariants` |
| "Icons on the choices" | `icon` on 16 options |
| "Don't accept 'לתאריך' as a date — but people may not have a date yet" | `validate: date` + `allowNotSet` + `invalidPrompt` + `reaskPrompt` |

The owner never once used an engine word. The Builder's job is to let them make each
of these changes themselves, in the words they used.

---

## 2. Evidence

### 2.1 Inside SocialCRM (inspected in the repo, 2026-10-06)

- **The customer automation builder** (`components/settings/automations/`,
  `docs/customer-automation-builder-spec.md` §12/§14, `-final.md` §7/§10):
  - It is event-first, with one screen and progressive reveal, and *explicitly not a
    wizard*. The card shows the automation as a sentence.
  - **Permanently refused:** a visual flowchart/canvas (*"deeply LTR-biased"*), if/else
    branching, loops, OR/nested conditions in V1, and user-written expressions.
  - Editing happens in a single modal sheet (`AutomationSheet.tsx`, ≤560px). The sheet
    reads as sections, with a live preview from the real resolver
    (`AutomationMessagePreview.tsx`, 350ms debounce).
  - Server error codes map to Hebrew in `sheetOptions.ts` (`ERRORS`). This is the
    established human-error pattern.
  - Recipes are *"pre-filled builder entries, not a parallel system"*.
- **The agent simulator** (`components/settings/autoResponse/AgentPreview.tsx` +
  `actions/autoResponse/previewAgent.ts`):
  - It runs the real pipeline and stops before sending. The transcript lives in client
    state, so nothing is persisted.
  - It shows "nothing is sent, no lead is created", and labels whether the test ran on
    the unsaved draft or the saved settings.
  - It has an RTL bubble thread, a note explaining a silent turn, and an Enter-to-send
    composer.
- **WhatsApp bubbles already exist:**
  - `components/settings/templates/WhatsappMessagePreview.tsx` (wallpaper + outbound bubble)
  - `components/summary/WhatsappConversation.tsx` (full thread, grouping)
- **Reordering** is up/down arrow buttons with Hebrew aria-labels
  (`components/quotes/QuoteTemplateItemsEditor.tsx`). **There is no drag-and-drop
  library in the app.**
- **Mobile:** complex editors either become a status + kill switch + read-only view
  (auto-response), or `MobileDesktopOnly` (`lib/mobile/desktopOnlyRoutes.ts`). No editor
  in the app uses tabs on mobile.
- **Versioning:**
  - ADR-008 chose edit-in-place for automations and rejected immutable copies.
  - The questionnaire runtime made the opposite choice, and production proved it
    necessary: a session freezes its definition, because "5" means a different option
    once a menu changes (§1.2, version pinning).

### 2.2 Outside SocialCRM

This section draws on product knowledge and was **not re-inspected in this session**.
Verify it before moving to `approved`.

- **Typeform:**
  - One question per card. The editor list mirrors the respondent's sequence, with a
    live preview of the current question.
  - Logic lives in a separate "Logic" panel. It is powerful, but owners commonly report
    it as the hardest part of the product.
- **Tally:**
  - A document-like editor. You type the form, and questions appear inline as you write.
  - Conditional logic is a block written as a sentence ("If [question] [is] [value] →
    show [blocks]").
  - Widely praised for "first form in minutes".
- **Google Forms:** branching is "go to section based on answer", attached to the
  option itself. It is simple, but it forces owners to think in sections.
- **ManyChat / Landbot / WhatsApp chatbot builders:**
  - The default is a node graph with drag-to-connect.
  - It is powerful, and it is the classic source of "I'm configuring a workflow engine".
    Owners delegate it to agencies.
- **WhatsApp Flows (Meta):** a JSON/screen builder aimed at developers. Its existence is
  why Meta partners ship their own simplified editors.

---

## 3. Common Pattern

1. **The editor mirrors what the respondent experiences.** The products owners rate
   easiest (Typeform, Tally) show the sequence the customer will walk. They don't show
   a graph.
2. **Logic is written as a sentence attached to the thing it affects.** Products
   that put logic in a separate canvas or panel are the ones owners call hard.
3. **Advanced settings exist but are collapsed by default.** The first question works
   with defaults.
4. **A preview is always one glance away. A test run is one click away.**
5. **Graph builders win on raw power and lose the non-technical owner.** SocialCRM's own
   automation spec reached the same conclusion and refused a canvas permanently.

---

## 4. Trade-offs

Exactly three directions were considered.

### A. Form-style settings editor (a modal per question, like `AutomationSheet`)

| + | − |
| --- | --- |
| Reuses the automation sheet almost as-is | The owner edits a form and must imagine the conversation |
| Lowest build cost | Branching becomes "settings of a setting"; the route structure is invisible |
| | Many modals for a 10-question questionnaire; fails §5 (inline editing) of the brief |

### B. Node-graph canvas (ManyChat-style)

| + | − |
| --- | --- |
| Branching is visually explicit | Already permanently refused by SocialCRM for automations (RTL, complexity) |
| Familiar to agencies | Fails User A outright: a first-time owner should never connect nodes |
| | A large new component system; violates the "never invent UI" rule at scale |

### C. Conversation editor (recommended)

A single column that reads like the WhatsApp chat, with inline expand-in-place
editing. Logic is written as sentences on the question, and the branch structure is
shown by indentation. A live preview and a one-click simulator sit beside it.

| + | − |
| --- | --- |
| The owner literally edits what the customer will see | The editor layout itself is new to the app and **requires approval (CLAUDE.md §14)** |
| Branching reads as "רק אם…", consistent with the automation builder's sentence pattern | Inline expand-in-place needs care to stay calm (one card open at a time) |
| Every primitive inside it already exists (bubbles, condition rows, Hebrew errors, simulator, arrows) | Very large questionnaires (12 questions, 2–3 routes) need the route view (§5.6) to stay readable |

---

## 5. Recommendation: **C. Conversation editor**

### 5.1 Layout

**Desktop:**

```
┌──────────────────────────── שאלון וואטסאפ ─────────────────── [▶ בדיקת השאלון] [פרסום השאלון] ┐
│                                                                                                     │
│  CONVERSATION (editor, ~620px)                       │  PREVIEW (phone frame, sticky)               │
│  ─────────────────────────────                       │                                              │
│  👋 פתיחה                                             │  ┌───────────────┐                           │
│  "היי 👋 ברוכים הבאים ל־Perfect Picture…"            │  │ wallpaper     │  ← WhatsappConversation   │
│  ─────────────────────────────                       │  │ bubbles of    │    bubbles, showing the   │
│  1  איזה אירוע או שירות צילום אתם מחפשים?            │  │ the step      │    step being edited, in  │
│     בחירה אחת · 7 אפשרויות                            │  │ being edited  │    context                │
│  ─────────────────────────────                       │  └───────────────┘                           │
│  2  קודם כל המון מזל טוב 🎉 מה תאריך האירוע?          │                                              │
│     📅 תאריך · אפשר להמשיך גם בלי תאריך              │                                              │
│     ↳ רק אם: חתונה, בר / בת מצווה, ברית, חינה        │                                              │
│  …                                                   │                                              │
│  🏁 סיום  (3 הודעות סיום)                             │                                              │
│  [ + הוספת שאלה ]                                     │                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Collapsed card:** each step is a card of exactly three lines: what the customer
  sees, what they can answer, and when it appears. These are the four things §18 of the
  brief says must be obvious; "what happens next" is the card below.
- **Expanded card:** clicking a card expands it in place, with only one open at a time.
  There is no modal for routine editing. Dialogs are reserved for destructive or
  multi-place changes (§5.9), per `frontend-experience-guidelines.md` §17.
- **Preview:** it follows the card being edited and shows that step in context, with the
  previous bubble and the customer's likely answer. The preview text comes from the
  runtime's own pure renderers (`render.ts`: `renderOpening`, `renderQuestion`,
  `menuLine`), so the preview **is** the production text, never an approximation.
- **Header:** two persistent actions. **▶ בדיקת השאלון** is the hero action, and
  **פרסום השאלון** is the single primary button (one primary action per screen).

### 5.2 Progressive disclosure: what is visible when

Simple by default. Power appears only when the owner's own choice makes it relevant.
There is no "advanced mode" and no second builder.

| Level | Appears | Contents |
| --- | --- | --- |
| **0: always** | Every expanded question | **השאלה** (the text) · **איך הלקוח עונה?** `[ בחירה אחת ] [ כמה אפשרויות ] [ טקסט חופשי ]` · the options list (choice) |
| **1: contextual** | Caused by a level-0 choice | Text → **איזו תשובה מצפים לקבל?** `[ טקסט ▼ ]` (טקסט / תאריך) · Date → **☑ אפשר להמשיך גם אם עדיין אין תאריך** (on by default) · an option row → icon + **איך עוד לקוחות עשויים לכתוב את זה?** · adding "אחר" → **☑ לשאול את הלקוח לפרטים** · a question after a choice → **מתי לשאול את השאלה הזו?** `○ תמיד ● רק אם…` |
| **2: אפשרויות נוספות** | One collapsed disclosure at the bottom of a card | Custom "didn't understand" message (`invalidPrompt`) · custom re-ask after a customer's question (`reaskPrompt`) |
| **Questionnaire settings** | A single sheet behind a link in the header | How many attempts before passing to a person (`maxInvalidAttempts`) · after how long an abandoned conversation goes to the team (`expireAfterHours`) · handoff message |

The owner can build and publish a complete questionnaire without opening a single
level-2 or settings surface (User A, §7).

### 5.3 Language map: engine → owner

The engine words never appear in the UI, in errors, or in help text.

| Engine | Owner sees |
| --- | --- |
| `type: choice` / `multi` / `text` | בחירה אחת · כמה אפשרויות · טקסט חופשי |
| `validate: 'meaningful'` | (invisible). It is the default for every new free-text question. The owner just sees "טקסט" |
| `validate: 'date'` | איזו תשובה מצפים לקבל? → **תאריך** |
| `allowNotSet` | ☑ אפשר להמשיך גם אם עדיין אין תאריך (date) / …אין מיקום (location, V1.1). CRM shows **טרם נקבע**; this is a sensible default, never asked about |
| `aliases` | **איך עוד לקוחות עשויים לכתוב את זה?** with the hint *"המערכת תזהה את הניסוחים האלה כאותה תשובה"* |
| `icon` | an emoji button at the start of the option row |
| `when` | **מתי לשאול את השאלה הזו?** ○ תמיד ● רק אם `[סוג האירוע]` הוא `[חתונה ✕] [חינה ✕] [+]` |
| `closingVariants` | **הודעת סיום מותאמת** → "כשהלקוח בחר `[סוג האירוע]` `[חתונה]`" + text |
| `invalidPrompt` / `reaskPrompt` | "מה לכתוב אם לא הבנו את התשובה" / "איך לשאול שוב אחרי שאלה של הלקוח" |
| `maxInvalidAttempts` | "אחרי כמה ניסיונות להעביר לנציג" |
| revision, pinning | "לקוחות שכבר באמצע השאלון ימשיכו בגרסה הקודמת" (shown only at publish, only when true) |
| step / option ids | never shown. Generated once, stable forever (§6.2) |

### 5.4 Smart defaults (owner customises only when needed)

| Owner action | Builder does automatically |
| --- | --- |
| New questionnaire | Opening pre-filled with the business name; standard closing; standard handoff; 2 attempts; 24 hours |
| New free-text question | `meaningful` checking (rejects only "?", "איפה", fillers), with a generic re-ask |
| Picks **תאריך** | Date checking + the date re-ask ("לא הצלחתי לזהות תאריך 📅 …") + "not decided yet" ON + the hint "אם עדיין לא נקבע תאריך, כתבו: לא נקבע" appended to the prompt preview |
| Adds an option | Its own label is recognised; the owner adds other phrasings only if they want. Hebrew prefixes ("לחתונה") and repeated letters are handled by the engine, so the owner never types them |
| Adds **אחר** (or an option containing it) | Offers ☑ "לשאול את הלקוח לפרטים" → creates the follow-up text question with the condition already set |
| Picks **כמה אפשרויות** | The menu hint "אפשר לבחור יותר מאחד, למשל: 1,3" is added by the engine; nothing to write |
| Writes a greeting at the start of a prompt ("קודם כל מזל טוב 🎉") | Suggests a re-ask without it (`reaskPrompt` pre-filled from the second paragraph) |
| Types a dash in customer text | Replaced inline with a comma, with a one-line explanation. The send path rewrites dashes anyway, so the preview must not lie |

### 5.5 Recognition phrases (aliases) without parser vocabulary

On an expanded option:

```
💍  חתונה                                    [↑][↓][🗑]
    איך עוד לקוחות עשויים לכתוב את זה?
    [אנחנו מתחתנים ✕] [מתחתנת ✕] [יש לנו חתונה ✕] [+ הוספת ניסוח]
    המערכת תזהה את הניסוחים האלה כאותה תשובה.
```

- **Conflicts are prevented, not reported later.** Typing a phrase that already belongs
  to another option shows, inline: *"הניסוח 'אחר' כבר מזוהה כ'אירוע אחר'"*. The chip is
  not added.
- **"Why did it choose this?"** is answered in the simulator (§5.8), which is where
  phrasing actually gets tuned.
- **Future work, not V1:** suggested phrasings drawn from real conversations the
  questionnaire re-asked. These are the owner's own customers' words, surfaced as
  one-click "add as a phrasing".

### 5.6 Branching that feels simple

- **The rule:** a sentence on the question. "**מתי לשאול את השאלה הזו?** ○ תמיד ● רק
  אם `[question ▼]` הוא `[options…]`". The question dropdown lists only earlier choice
  questions, so a forward or circular dependency is impossible to construct.
- **One condition per question in V1.** That is exactly what the runtime supports and
  what Perfect Picture needed. The brief's "+ הוסף תנאי" (AND) needs a runtime change
  (§6.4) and is deferred.
- **The route view.** Conditional questions are indented under their condition chip in
  the conversation list. A toggle, **תצוגת מסלולים**, derives a read-only outline from
  the conditions:

  ```
  💍 חתונה · 🎉 בר/בת מצווה · 👶 ברית · 🪬 חינה   ↳ תאריך (עם מזל טוב) ↳ מיקום ↳ שירות צילום ↳ סיום + קישור*
  💼 אירוע עסקי                                  ↳ תאריך ↳ מיקום ↳ שירות צילום ↳ סיום
  ✨ אירוע אחר                                   ↳ איזה אירוע? ↳ תאריך ↳ מיקום ↳ שירות צילום ↳ סיום
  🚁 רחפן / נדל״ן                                ↳ מיקום צילום ↳ אישור הטסה ↳ תאריך צילום ↳ סיום רחפן + קישור
  ```

  It is computed from the definition, never edited as a graph. It is also where
  "this route has no ending" style problems become visible before publish.
- **No canvas, no connectors, ever.** This is consistent with the automation spec's
  permanent refusal.

### 5.7 Conditional closings and links

The **🏁 סיום** card holds the default closing and a list:

**+ הודעת סיום מותאמת** → "כשהלקוח בחר `[סוג האירוע]` `[חתונה]`" + the text (links typed
inline).

- **Order:** the first matching closing wins. The UI states this once ("נבדקות מלמעלה
  למטה") and allows reordering with arrows.
- **Coverage:** each route in the route view shows which closing it will receive.
  Perfect Picture's three closings and two different URLs are three rows here.

### 5.8 ▶ בדיקת השאלון (hero feature)

- **Pattern:** it mirrors `AgentPreview`, as a WhatsApp-style thread with an Enter-to-send
  composer and "שיחה חדשה" / "סגירה".
  - The banner says: *"זו בדיקה. שום הודעה לא נשלחת ושום ליד לא נוצר."*
  - It labels whether the test runs on the **unpublished draft** or the **published
    questionnaire**.
- **Mechanism:**
  - A server action runs the pure runtime state machine (`decideQuestionnaireTurn`) on
    the draft definition and a client-held transcript, with nothing persisted.
  - This is not a reimplementation. It is the production decision function, so the test
    is exact.
  - Simulated "early" messages and the owner-takeover race are out of scope for the
    simulator. They are covered by tests.
- **Explanation:** under a bot bubble, an unobtrusive link: **למה המערכת בחרה בזה?** It
  expands to:
  - זוהה: **חתונה** · מתוך: "אנחנו מתחתנים" · השאלה הבאה: **תאריך האירוע**
  - or: "לא זוהתה תשובה — נשאל שוב (ניסיון 1 מתוך 2)"
  - or: "זו שאלה של הלקוח — נציג יענה; לא נספר כניסיון"
  - or: "הלקוח שלח כמה הודעות — 'רחובות' נשמרה לנציג"

  This is derived from the decision's own reason and answer shape (the same fields the
  production trace carries).
- **After the test:** the simulator ends with the exact CRM summary the rep would get
  (`renderSummary`), so the owner sees "טרם נקבע", the flagged corrections and the extra
  messages before publishing.

### 5.9 Prevent, then explain: publishing and errors

- **Prevention while editing (constraints, not errors):**
  - The condition picker only offers earlier questions.
  - Option labels show a 24-character counter, and the input stops there (the WhatsApp
    list limit).
  - Phrase conflicts are blocked inline.
  - The **delete** of an option or question that something depends on opens a dialog
    listing every dependent:

    > האפשרות "חתונה" משמשת ב־3 מקומות בשאלון: ↳ "מה תאריך האירוע?" (מוצגת רק אם…) ↳
    > "איפה האירוע יתקיים?" ↳ הודעת סיום מותאמת
    > `[ מחיקה והסרה מהתנאים ]` `[ ביטול ]`

  - Moving a question above the question it depends on disables that arrow, with a
    tooltip: "השאלה תלויה ב'סוג האירוע' ולכן חייבת להופיע אחריה".
- **Publish (פרסום השאלון)** runs a pre-flight, then a confirmation sheet:
  - Every runtime validation error, translated to Hebrew with a **תקן עכשיו** link that
    scrolls to and opens the card. This extends the `sheetOptions.ts` `ERRORS` mapping
    pattern; no raw message ever reaches the owner.
  - Structural checks the runtime does not do: a question no route can reach; a route
    with no closing other than the default (informational); an "אחר" with no follow-up
    (suggestion only); an empty option list.
  - The confirmation reads **✓ השאלון מוכן לפרסום** plus, only when true, "2 לקוחות
    באמצע השאלון ימשיכו בגרסה הקודמת".
  - Behind the button: compile → validate with the runtime's zod schema → store a new
    immutable revision → switch `responder` to the questionnaire (§6.3).
- **Example error translations:**

  | Runtime message | Owner sees |
  | --- | --- |
  | `step 'x' conditions on unknown option 'wedding' of 'event_type'` | האפשרות "חתונה" נמחקה, אבל השאלה "מה תאריך האירוע?" עדיין תלויה בה. **תקן עכשיו** |
  | `alias 'אחר' belongs to both …` | הניסוח "אחר" מזוהה גם כ"אירוע אחר" וגם כ"אחר". **תקן עכשיו** |
  | `closing variant 0 conditions on unknown option` | הודעת הסיום המותאמת ל"צילום רחפן" מתייחסת לאפשרות שנמחקה. **תקן עכשיו** |
  | `option label must be at most 24 characters` | (prevented while typing) |

### 5.10 Templates accelerate, never lock

- **The start screen:** **איך תרצו להתחיל?** offers `[ שאלון חדש ]` plus industry
  templates (צילום ואירועים · יופי וטיפוח · נדל״ן · עורכי דין · מרפאה).
- **A template becomes an ordinary draft.** There is no template mode afterwards. This
  is the automation builder's recipe rule.
- **Perfect Picture revision 4 is the first template:** "צילום ואירועים", with the
  business name and URLs blanked.

### 5.11 Mobile

- **Precedent:** this repository's mobile precedent is clear. Complex editing is desk
  work (`AutoResponseMobile` says so explicitly; `MobileDesktopOnly`), and no editor uses
  tabs on mobile.
- **V1 on mobile:**
  - A read-only **conversation view**: the same three-line cards, plus the route view.
  - **▶ בדיקת השאלון**: the simulator, which is genuinely useful from a phone.
  - The on/off switch, which already exists.
  - Editing is desktop-only, via a "לעריכה, פתחו במחשב" handoff (`MobileSectionHandoff`).
- **V2, only if usage shows owners trying to edit on phones:** `שאלות → עריכה → תצוגה`
  as separate full-screen views (`BottomSheet` for an expanded card). Never a shrunken
  desktop canvas.
- **This deliberately departs from §17 of the brief.** The brief invites mobile editing.
  The evidence-based recommendation is to ship the mobile read/test/switch first and
  add editing on observed demand (per "optimise from evidence").

### 5.12 Reordering

- **V1:** arrow buttons (`QuoteTemplateItemsEditor` pattern), disabled where a move would
  break a dependency.
- **Drag-and-drop** (brief §5) needs a new dependency (e.g. `@dnd-kit`) and is **not**
  in the app today. Per CLAUDE.md §14 it is listed as a decision for approval, not
  assumed.

---

## 6. Why this fits SocialCRM

### 6.1 Product and design system

- **North star:** it serves the product north star ("understood in 5 seconds"). The
  collapsed card *is* the 5-second read.
- **Reuse:** it reuses, rather than invents:
  - bubbles (`WhatsappConversation` / `WhatsappMessagePreview`)
  - condition rows (`ConditionsEditor` grid)
  - Hebrew error mapping (`sheetOptions.ts`)
  - the simulator (`AgentPreview` + `previewAgent`)
  - arrows (`QuoteTemplateItemsEditor`)
  - mobile handoff (`MobileSectionHandoff`)
  - the sentence pattern and "no canvas" rule (automation builder)
- **What is genuinely new and needs approval (CLAUDE.md §14):**
  - the conversation editor layout (single column + sticky phone preview)
  - inline expand-in-place cards
  - the derived route view
- It honours the Care Charter: the owner configures a calm, honest conversation. Every
  safety behaviour (נציג, opt-out, takeover, nothing lost) is a property of the engine
  that the owner cannot turn off by accident.

### 6.2 Architecture: a translation layer, not a second engine

- **The Builder edits the runtime definition itself.** The definition is already
  declarative, typed (zod) and versioned. There is no separate Builder model to drift
  from it.
- **"Compile" is:**
  - generate ids
  - normalise customer text (dashes)
  - run the runtime schema
  - run Builder pre-flight

  So the preview, simulator, publish validation and production are all the same code.
- **Stable identity (non-negotiable):**
  - Step and option ids are generated once (`q1…`, `o1…`, ASCII, matching the schema's
    `[a-z0-9_]`) and **never change**. Renaming the label "חתונה" keeps id `o1`.
  - Pinned sessions, stored answers, CRM summaries and closing conditions all refer to
    ids. Regenerating them on edit would silently corrupt history.
  - The owner never sees an id.
- **Draft vs published:**
  - The draft is editable and autosaved.
  - Publish stores an immutable revision; the runtime reads only published revisions.
  - Active sessions stay on their own revision (already shipped).
  - This deliberately differs from ADR-008's edit-in-place for automations, for the
    reason proven in production (§2.1). If approved, it warrants its own ADR.
- **Storage:** today a single `auto_response_settings.questionnaire` jsonb holds the
  published definition. A draft needs somewhere to live.
  - **Option 1:** an additive `questionnaire_draft jsonb` column.
  - **Option 2:** a `questionnaire_revisions` table (draft row + immutable published
    rows, which gives history and rollback for free).
  - Either is a schema change. Per CLAUDE.md §4 and `do-not-touch.md` §2 it needs an
    explicit migration plan and approval. **Recommendation: Option 2**, because rollback
    ("חזרה לגרסה הקודמת") becomes one row switch instead of a staff dry run.
- **No new runtime surface for the simulator:** it calls the pure
  `decideQuestionnaireTurn`; the preview calls the pure renderers.

### 6.3 Who may publish

- Publishing switches the agency's `responder` and is customer-facing, so it is
  owner/admin only.
- Today's env allowlist (`WA_QUESTIONNAIRE_AGENCY_IDS`) stays the rollout gate.
  Self-service publish must not bypass it until the Builder itself is rolled out.

### 6.4 Runtime gaps the Builder will surface (not built here; each needs approval)

| # | Gap | Needed for | Size |
| --- | --- | --- | --- |
| 1 | Conditions are single-source `anyOf`; no AND across questions | "+ הוסף תנאי" (brief §6) | Small runtime + schema change |
| 2 | `maxInvalidAttempts` is questionnaire-wide; no per-question fallback (skip vs person) | per-question "advanced fallback" (brief §2) | Small |
| 3 | The not-set display text is fixed ("טרם נקבע") | configurable display (earlier audit §27) | Trivial |
| 4 | `invalidPrompt` exists for text questions only | custom "didn't understand" on a choice | Trivial |
| 5 | No location answer kind (location = `meaningful` + `allowNotSet` + copy) | "תשובה: מיקום" as a first-class choice | Small (a preset, not a new validator) |
| 6 | The customer-question cap (3) and the acknowledgement line are global | owner wording of the acknowledgement | Trivial |
| 7 | Draft/revision storage | the whole Builder | Migration (§6.2) |
| 8 | `@dnd-kit` (or equivalent) | drag reordering | New dependency |

---

## 7. UX acceptance test

The brief requires both users to pass. *"If User A feels overwhelmed, the UX failed.
If User B cannot reproduce Perfect Picture, the UX failed."*

### 7.1 User A: beauty salon, first time, no documentation

**Goal:** opening → which treatment (3 choices) → preferred date → customer name →
completion.

| # | Screen | Action | Clicks |
| --- | --- | --- | --- |
| 1 | הגדרות › מענה אוטומטי | **יצירת שאלון** | 1 |
| 2 | איך תרצו להתחיל? | **שאלון חדש** (or "יופי וטיפוח" → skip to 10) | 1 |
| 3 | Builder | Opening is pre-filled with the salon's name; click it, edit the wording | 1 + typing |
| 4 | | **+ הוספת שאלה**; type "איזה טיפול מעניין אתכם?" (בחירה אחת is the default) | 1 + typing |
| 5 | | Type 3 options, pressing Enter after each | 0 + typing |
| 6 | | **+ הוספת שאלה**; type "מתי נוח לכם להגיע?"; click **טקסט חופשי** | 2 + typing |
| 7 | | **איזו תשובה מצפים לקבל?** → **תאריך** ("אפשר להמשיך גם בלי תאריך" is already ticked) | 2 |
| 8 | | **+ הוספת שאלה**; type "איך קוראים לך?"; click **טקסט חופשי** | 2 + typing |
| 9 | | Closing is pre-filled; click it and adjust | 1 + typing |
| 10 | | **▶ בדיקת השאלון** (optional; types like a customer) | 1 |
| 11 | | **פרסום השאלון** → "✓ השאלון מוכן לפרסום" → **פרסום** | 2 |

- **Screens:** 3 (settings → start → builder, with the publish confirmation as a sheet).
- **Clicks:** ~14 without the test, ~15 with it. Typing is the rest.
- **Concepts the owner must understand:** *a question*, *a way to answer* (one of
  three), *a date answer*. Three. They never meet conditions, phrasings, icons, closings,
  attempts or revisions.
- **Time estimate:** about 3–4 minutes, almost all of it typing Hebrew copy. **Passes
  the < 5 minute target.**
- **Overwhelm check:** at no point are more than six controls visible on the open card
  (question text, three answer-type chips, an options list, one contextual control).

### 7.2 User B: Perfect Picture revision 4, familiar with the Builder

Starting from the "צילום ואירועים" template, almost everything below is pre-built and
B only edits. Starting from blank:

| Need (rev 4) | Where and how | Owner-facing words |
| --- | --- | --- |
| Entry question, 7 options | Question 1, בחירה אחת, 7 option rows | — |
| Icons | The emoji button on each option row | — |
| Natural recognition | On each option: **איך עוד לקוחות עשויים לכתוב את זה?** + chips. The engine handles prefixes and repeated letters | "ניסוחים" |
| Wedding / private-event route | Question 2 "קודם כל המון מזל טוב 🎉 מה תאריך האירוע?" → **רק אם** סוג האירוע הוא חתונה, בר/בת מצווה, ברית, חינה | "מתי לשאול" |
| Business/other date without congratulations | Question 3, same question without the greeting → **רק אם** עסקי, אחר. The route view shows the two date questions side by side | — |
| Date checking + no-date-yet | **איזו תשובה מצפים לקבל? → תאריך** (auto: re-ask text, not-set ON, "טרם נקבע") | "תאריך", "אפשר להמשיך גם אם…" |
| Re-ask without repeating the congratulations | Auto-suggested from the greeting paragraph (§5.4); visible under אפשרויות נוספות | "איך לשאול שוב" |
| Location with not-set | Text + (V1) the date-style checkbox reads "אפשר להמשיך גם אם עדיין אין מיקום" when the location preset exists (gap #5); before that, under אפשרויות נוספות | — |
| Multi-select services + "הכל" | Question: **כמה אפשרויות**, 6 options with icons | — |
| "Other" event → describe | Add **אחר** to question 1 → ☑ "לשאול את הלקוח לפרטים" auto-creates "בשמחה, איזה אירוע…" with its condition | — |
| "Other" service → describe | The same on the service question | — |
| Drone route | Three questions, each **רק אם** סוג האירוע הוא רחפן / נדל״ן; permit = בחירה אחת (כן ✅ / לא ❌ / לא יודע 🤷) with phrasings | — |
| Conditional closings + two URLs | 🏁 סיום → **+ הודעת סיום מותאמת** ×3: רחפן (text + link), בר/בת מצווה + חינה (link), חתונה (Wisepage link); the default has no link | "הודעת סיום מותאמת" |
| Verify | ▶ בדיקת השאלון: "אנחנו מתחתנים" → "למה המערכת בחרה בזה?" shows חתונה ← "אנחנו מתחתנים" → תאריך | — |
| Publish | פרסום → "לקוח אחד באמצע השאלון ימשיך בגרסה הקודמת" | — |

- **Result:** every revision-4 behaviour is reproducible.
- **Two known gaps:** none blocks reproduction.
  - **Gap #5:** location as a first-class answer type. It is achievable today via text +
    advanced options.
  - **Gap #1 (AND conditions):** Perfect Picture does not need it.
- **Time estimate, once familiar:** 10–15 minutes from blank (the 7 options, ~45
  phrasings and 4 closings are most of the typing). About 3 minutes from the template.
  **Passes.**
- **Engine words B ever sees:** none.

---

## 8. Decisions requested from the Creative Director

1. Approve direction **C** (conversation editor + sticky preview + derived route view)
   as a new layout (CLAUDE.md §14).
2. Approve **mobile V1 = read / test / on-off, editing on desktop**, versus the
   brief's mobile editing (§5.11).
3. Approve **arrow reordering for V1**; drag-and-drop as a later dependency decision
   (§5.12).
4. Approve **revisioned storage** (`questionnaire_revisions` table, migration plan to
   follow) and an ADR recording why questionnaires are immutable-per-publish while
   automations are edit-in-place (§6.2).
5. Prioritise runtime gaps #5 (location preset) and #1 (AND conditions) for V1 or
   defer them (§6.4).
6. Confirm the external-product evidence (§2.2) is re-inspected before status moves to
   `approved`.
