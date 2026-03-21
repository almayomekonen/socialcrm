# ux-guidelines.md — UX Rules & Standards

## 1. CORE UX PRINCIPLES

These are non-negotiable. Every screen, component, and interaction must follow them.

- **5-second rule** — the user must understand what to do within 5 seconds of landing on any screen
- **Every screen leads to an action** — no dead ends, no informational-only screens without a next step
- **Never show empty UI without guidance** — an empty list is not acceptable without a CTA and explanation
- **Reduce thinking, increase doing** — if the user has to figure something out, the UI has already failed
- **Confidence over cleverness** — the user must always feel in control, never confused or uncertain

---

## 2. FIRST ACTION PRIORITY

When a user has no leads, the system has one job: get them to add or import leads.

- The primary CTA on an empty state must be one of:
  - **"הוסף ליד"** — for adding a single lead
  - **"העלה לידים"** — for importing from Excel
- These two actions must always be visible and prominent
- Do not hide them behind menus, modals, or secondary flows
- If the user has leads, the primary action shifts to: **review → update status → follow up**

---

## 3. BUTTON & ACTION RULES

Every button must describe exactly what will happen when clicked.

**Bad — too vague:**

- "שמור"
- "אישור"
- "המשך"
- "בצע"

**Good — specific and clear:**

- "שמור שינויים"
- "הוסף ליד"
- "העלה לידים"
- "עדכן סטטוס"
- "שייך נציג"

**Rules:**

- No one-word buttons unless the action is universally understood (e.g., "ביטול")
- Destructive actions (delete, remove) must be red and require confirmation
- Primary buttons must be visually distinct — one per screen/section
- Disabled buttons must show a reason when hovered or tapped

---

## 4. EMPTY STATE RULES

Every empty state must answer three questions:

1. **What is happening** — "אין לידים עדיין"
2. **Why it matters** — "כדי להתחיל לעבוד, צריך להוסיף לידים למערכת"
3. **What to do next** — a visible, primary CTA: "הוסף ליד" or "העלה לידים"

**Never:**

- Show a blank table or empty list with no explanation
- Show only an icon or illustration with no text
- Show a message without a next action

---

## 5. HIERARCHY

Every screen must have a clear visual hierarchy:

- **Primary action** — one per screen, highlighted (filled button, strong color)
- **Secondary action** — supporting the primary (outline button or text link)
- **Optional/destructive actions** — low visual weight, never competing with primary

If two actions look equally important, the user will hesitate. Pick one primary. Always.

---

## 6. TERMINOLOGY RULES

Use consistent Hebrew terminology throughout the entire system.

**Use:**

- `ליד` / `לידים` — for all lead references
- `נציג` — for the assigned sales rep
- `סטטוס` — for lead status

**Avoid:**

- `לקוח` — this implies they already purchased; leads are not yet customers
- `סוכן` — insurance terminology, wrong context
- `עסקה` — too formal, implies a complex sales process
- Mixing terms across screens (e.g., "ליד" on one page and "לקוח" on another)

**Rule:** if a new term is introduced, it must be used consistently everywhere or not at all.

---

## 7. COMPLEXITY CONTROL

Do not add complexity before the user has gotten value.

- Never require configuration before the user can see or add leads
- Avoid multi-step flows for simple tasks — adding a lead should be 1 screen, not a wizard
- Avoid settings, filters, or advanced options that are irrelevant to new users
- If a feature requires more than 2 clicks to reach, ask whether it belongs in the main flow
- Prefer a simple action the user takes now over a powerful feature they'll configure later

---

## 8. FEEDBACK & CONFIRMATION

Every action must produce a visible response.

- **On save/update** — show a success message: "השינויים נשמרו" (toast or inline)
- **On import** — show count: "יובאו 24 לידים בהצלחה"
- **On error** — show a clear message with what went wrong and what to do
- **On delete/remove** — require confirmation, show what will be deleted
- **On assign** — confirm who was assigned: "הליד שויך ל־[שם נציג]"

Users must always feel that the system heard them and responded. Silence after an action creates doubt.

---

## 9. TRUST & VISUAL CLARITY

The system is used by non-technical users managing real business leads. The UI must feel professional and reliable.

- **No confusing or ambiguous icons** — every icon must be accompanied by a label
- **No playful or decorative visuals** — no illustrations that don't serve a functional purpose
- **Consistent spacing and alignment** — a messy layout signals an unreliable product
- **Predictable patterns** — actions in the same category should look and behave the same way
- **No color used for decoration** — color must carry meaning (status, priority, error, success)

If a design element makes the UI look "nicer" but adds no clarity — remove it.

---

## 10. DECISION RULE

Before implementing any UX change, ask:

1. Does this **reduce confusion** for the user?
2. Does this help the user **act faster**?

If the answer to both is not clearly yes → **do not implement.**

A feature that looks good but slows the user down is a step backward. A screen that is "clean" but gives no direction is a failure.

The goal is not a beautiful UI. The goal is a UI that works.

---

## 11. LAYOUT & STRUCTURE RULES (CRITICAL)

UI must not introduce new layouts or standalone sections that break the page structure.

Always follow existing layout patterns.

### Rules:

- Do NOT create new full-width sections that are not part of the existing layout
- Do NOT insert "welcome banners" or standalone onboarding blocks above existing pages
- Do NOT stack unrelated UI blocks vertically if they represent different states

### Instead:

- Reuse existing containers (table, cards, dashboard sections)
- Replace content INSIDE them — do not add new layout layers

---

### State-driven rendering (MANDATORY)

Every page must have clearly defined states.

At the top-level (page level), rendering must be controlled by data state — not component-level conditions.

Define:

1. **Empty system state (no data at all)**  
   → Render ONLY onboarding / empty state  
   → Do NOT render dashboard, charts, filters, or tables

2. **Filtered empty state (data exists, filter returns 0)**  
   → Render full UI (dashboard, filters, table)  
   → Show empty state ONLY inside the relevant component (e.g., table)

3. **Data state (data exists)**  
   → Render full UI normally

---

### Critical rule:

Never render multiple states at the same time.

Bad:

- onboarding + dashboard together

Good:

- exactly one state visible at a time

---

## 12. NO UI INVENTION RULE

Never invent new UI patterns, layouts, or visual styles.

Before creating UI:

1. Search for an existing similar component
2. Reuse its structure, spacing, and hierarchy
3. Adapt — do not create from scratch

If no match exists:
→ use the closest existing pattern
→ do NOT introduce a new design system

The product must feel consistent across all screens.

## Entity Rule

Do not create separate views or pages for "Clients".

All users are displayed as Leads.

Different states are represented only by status.
