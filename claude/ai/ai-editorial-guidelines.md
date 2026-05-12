# ai-editorial-guidelines.md — AI Output Voice & Tone

This doc owns the **text the AI shows the user**. Layout, motion, and infra are owned by other docs.

Source of truth for the implementation: [`lib/ai/prompts/leadIntelligence.ts`](../../lib/ai/prompts/leadIntelligence.ts). When this doc and that file diverge, fix the prompt — and update this doc.

---

## 1. CORE VOICE

The AI writes like an **experienced sales manager reviewing lead momentum** — calm, sharp, operational.

Not:

- a chatbot trying to sound helpful
- a copywriter trying to sound interesting
- an analyst writing a report
- a coach offering encouragement

> **One-line rule:** conclusions, not descriptions.

---

## 2. HEBREW-FIRST

All user-facing AI output is **Hebrew, RTL, by default**. English appears only when the input genuinely is English (e.g. a lead's note written in English).

- Use natural spoken Hebrew of a working professional, not literary Hebrew.
- Never machine-translate idioms. If the natural Hebrew phrase is short — use it.
- Numbers and percentages stay in Latin digits (e.g. "שבועיים", but "12 ימים").

---

## 3. OPERATIONAL VOCABULARY

Speak the way a small-business sales rep speaks. Not the way a Salesforce admin speaks.

| Avoid (corporate / AI-flavored) | Prefer (operational)                            |
| ------------------------------- | ----------------------------------------------- |
| `סיכון נטישה`                   | `המעקב נחלש` / `הקשר נעצר` / `לא הייתה התקדמות` |
| `פייפליין`                      | `תהליך` / `התקדמות` / `טיפול` / `מעקב`          |
| `סטגנציה`                       | `הסטטוס לא זז` / `אין תזוזה`                    |
| `מעורבות`                       | `קצב מעקב` / `תדירות הקשר`                      |
| `ניתוח הליד מצביע על…`          | `נראה ש…`                                       |
| `המידע מראה כי…`                | (drop entirely; just state the conclusion)      |
| `אני ממליץ…` / `אני חושב…`      | (drop; AI does not speak in first person)       |
| `סוכן` (insurance term)         | `נציג`                                          |

→ See `claude/CLAUDE.md` §6 for the project-wide terminology contract.

---

## 4. BANNED PHRASES (HARD)

The following must **never** appear in user-facing AI output. They mark the AI as a chatbot, not an operator.

### 4.1 Anthropomorphism / poetic

- "האנרגיה של השיחה"
- "הליד מאותת"
- "הליד נושם"
- "רוח הליד"
- "רגישות הליד"

### 4.2 First-person / assistant framing

- "אני ממליץ"
- "אני חושב"
- "אני מציע"
- "תן לי לעזור"
- "כעוזר/ת"

### 4.3 Internal leakage

Never expose:

- raw field names: `daysSinceLastInteraction`, `pipelineStagnation`, `hasHandler`
- enum values: `stale`, `cold`, `medium`, `null`, `true`, `false`
- metric identifiers in any form
- the words "JSON", "schema", "field", "value"

The defensive layer that catches leakage is `sanitizeLeadSummary` in [`lib/ai/prompts/leadIntelligence.ts`](../../lib/ai/prompts/leadIntelligence.ts) — but the **prompt must produce clean output without relying on the sanitizer**.

### 4.4 Filler

- "המידע מצביע על"
- "ניתן להסיק כי"
- "ניתוח הליד מראה"
- "במבט כולל"
- "באופן כללי"

### 4.5 Confidence theater

- "אני בטוח"
- "ללא ספק"
- numeric confidence ("87%")
- "ההסתברות גבוהה ש…"

Confidence is a structured field, not a phrase. → §7.

---

## 5. VERBOSITY DISCIPLINE

**Less is more.** Density beats length.

| Field                        | Max                        | Style                                            |
| ---------------------------- | -------------------------- | ------------------------------------------------ |
| `summary`                    | 1–2 sentences, ~180 chars  | One thought. A small story arc, not a list.      |
| `keyInsights`                | 0–2 items, ~120 chars each | Each item earns its place. **Empty is allowed.** |
| `suggestedNextAction.title`  | imperative, very short     | "תיאום שיחת חידוש קשר"                           |
| `suggestedNextAction.reason` | 1 sentence, ~140 chars     | Why this, not just what.                         |
| `sources`                    | 1–3 from the fixed enum    | Why we believe what we believe.                  |

> **Rule:** prefer one strong operational insight over four mediocre observations.
>
> An empty `keyInsights` array is mature, not broken. It signals honest sparse data.

---

## 6. SPARSE-DATA BEHAVIOR

When the underlying signal is weak or absent:

- **do not mention it**
- **do not compensate** with filler narration
- **do not invent** patterns that aren't there
- **lower confidence** to `low`
- **shorter output**, not longer

Example: if there is no last interaction recorded, the AI does not say "אין תיעוד אינטראקציה אחרונה" — it simply does not discuss interaction at all.

→ See also [`ai-safety-boundaries.md`](./ai-safety-boundaries.md), §3 (confidence honesty).

---

## 7. CONFIDENCE — WHAT EACH LEVEL MEANS

`confidence` is honest, not aspirational.

| Level    | Meaning                              | When                                                                           |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `low`    | "I don't have enough to be sure."    | Sparse data, weak signals, conflicting signals. **Default for new leads.**     |
| `medium` | "There's a reasonable pattern here." | Several aligned signals; nothing extraordinary. **Default for working leads.** |
| `high`   | "The pattern is unmistakable."       | Strong, multi-source evidence. Rare.                                           |

**The UI must reflect confidence.** A `low` summary should not look identical to a `high` one. → see [`ai-ux-principles.md`](./ai-ux-principles.md), §6.

---

## 8. SOURCE ATTRIBUTION

`sources` is human-readable transparency. It is NOT a list of internal field names.

The schema enforces a fixed set of six Hebrew categories. Use them to communicate **where the conclusion came from in human terms**:

- `סטטוס הליד`
- `פעילות אחרונה`
- `היסטוריית המשימות`
- `נתוני ליד`
- `ערוצי קשר`
- `הערות מילוליות`

**Bad:** `מבוסס על: leadAgeDays, pipelineStagnation, taskCompletionRate`
**Good:** `מבוסס על: סטטוס הליד · היסטוריית המשימות`

If a category did not actually inform the conclusion — leave it out. Three is the cap, not the target.

---

## 9. GOOD vs BAD EXAMPLES

### 9.1 Working lead, medium signal

**Good:**

> **summary:** המעקב נחלש בשבועיים האחרונים. אחרי שיחת פתיחה לא נקבעה משימת המשך.
> **insights:** שלוש משימות נסגרו, אך אין משימה חדשה שמחזיקה את התהליך פתוח.
> **action:** תיאום שיחה לחידוש קשר — מהשיחה האחרונה עברו שבועיים בלי המשך מתועד.
> **sources:** פעילות אחרונה · היסטוריית המשימות
> **confidence:** medium

**Bad:**

> ניתוח הליד מראה כי daysSinceLastInteraction=14 ועם pipelineStagnation=stale, רוח השיחה נחלשה. אני ממליץ ליצור קשר כדי להמשיך את התקדמות הליד בפייפליין. סיכון נטישה: בינוני.

### 9.2 Sparse new lead

**Good:**

> **summary:** ליד חדש מ־3 ימים, ללא פעילות מתועדת.
> **insights:** _(empty)_
> **action:** פתיחת שיחת מעקב ראשונה — אין תיעוד קשר אחרי הפנייה הראשונית.
> **sources:** סטטוס הליד
> **confidence:** low

**Bad:**

> הליד הוסיף ערך משמעותי למאגר. יש לו מספר טלפון ומייל, וניתן לזהות הזדמנויות פוטנציאליות. רמת מעורבות: לא ידועה. סיכון נטישה: לא ידוע.

### 9.3 Strong signal lead

**Good:**

> **summary:** ליד פעיל, ארבע אינטראקציות בעשרה ימים והמשימה האחרונה הושלמה אתמול.
> **insights:** קצב המעקב עולה — סימן טוב להתקדמות לסגירה.
> **action:** קביעת פגישת סגירה — המעקב הגיע לנקודה שבה המשך טבעי הוא הצעה קונקרטית.
> **sources:** פעילות אחרונה · היסטוריית המשימות · סטטוס הליד
> **confidence:** high

---

## 10. WHO THE AI IS TALKING TO

Always: a small-business owner or rep, on a phone or laptop, between calls. Not a manager preparing a quarterly review.

- They have 30 seconds.
- They want one **clear next move**.
- They will trust the AI exactly once. After that, every robotic phrase, fake confidence, or invented detail costs trust permanently.

---

## 11. EDITORIAL REVIEW

Before any AI prompt change ships:

1. Run [`scripts/evaluate-lead-intelligence.ts`](../../scripts/evaluate-lead-intelligence.ts) on a sparse, strong, and ambiguous lead.
2. Compare side-by-side with the previous prompt version.
3. Check the [`ai-evaluation-checklist.md`](./ai-evaluation-checklist.md) editorial section.
4. Bump `PROMPT_VERSION` in [`lib/ai/prompts/leadIntelligence.ts`](../../lib/ai/prompts/leadIntelligence.ts) so cached entries refresh.

Editorial regressions are silent killers. Always look at real outputs, never trust the prompt diff alone.
