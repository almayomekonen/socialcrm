# product.md — Product & User Definition

## 1. TARGET USERS

**Who they are:**

- Small business owners running their own sales
- Sales representatives handling inbound leads
- People receiving leads daily from Facebook ads, Instagram DMs, and WhatsApp messages

**Their daily reality:**

- They get leads from multiple sources at random times
- A lead comes in on WhatsApp, another on Instagram, another from a Facebook form
- They try to keep track using a WhatsApp group, an Excel sheet, a notebook, or just memory
- They're busy — they're also the ones closing deals, not just managing them

**How they currently manage leads:**

- Copy-pasting names and numbers into Excel
- Sending themselves WhatsApp messages as reminders
- Sticky notes, phone notes, memory
- No consistent system — it breaks down quickly

---

## 2. CORE PROBLEM

Leads arrive fast and from everywhere. There's no single place to see them all.

- A lead comes in, gets buried in a chat, and is never followed up
- It's impossible to know: who has been called, who hasn't, what the status is
- Leads fall through the cracks — not because no one cared, but because there was no system
- There's no way to tell what's working and what's being lost

The result: real money walks away, and no one knows exactly where.

---

## 3. EMOTIONAL PAIN

Users feel:

- **Overwhelmed** — too many leads, too many places, not enough time
- **Out of control** — they know they're missing follow-ups but don't know which ones
- **Frustrated** — they built a system (Excel, WhatsApp) that doesn't actually work
- **Guilty** — they sense they're losing opportunities they should have closed
- **Reactive, not proactive** — always catching up, never ahead

---

## 4. DESIRED OUTCOME

What users actually want:

- One place where all leads live — no matter where they came from
- A clear status on every lead: new, in progress, closed, lost
- Easy follow-up: see who to call today without thinking about it
- The feeling of being in control of their pipeline

They don't want a complex system. They want clarity.

---

## 5. CORE VALUE

👉 "This product turns scattered leads into a clear list of people to call — so nothing falls through the cracks."

---

## 6. MAIN ACTIONS

The actions users need to take, in order of importance:

1. **Add a lead** — quickly, from any source
2. **Import leads** — bulk upload from Excel when they have a backlog
3. **Assign leads** — to themselves or a team member
4. **Track progress** — update status, add notes, see what needs follow-up

---

## 7. FIRST SUCCESS MOMENT

The moment a user feels: _"Oh, this actually helps me."_

👉 **They import their Excel file, and within 60 seconds they can see all their leads organized in one place — with status, name, and source visible at a glance.**

Before: a messy spreadsheet.
After: a clear list they can actually act on.

That's the moment.

---

## 8. WHY THEY WOULD PAY

- **Saves time** — no more copying between WhatsApp, Excel, and notebooks
- **Prevents lost leads** — every lead is tracked, nothing disappears
- **Improves closing rate** — follow-ups happen because the system reminds you, not because you remembered
- **Reduces stress** — they feel in control instead of constantly catching up

The ROI is simple: one recovered lead pays for months of the product.

---

## 9. WHAT WE ARE NOT

- Not an insurance platform
- Not an enterprise CRM with complex pipelines, automations, and dashboards
- Not built for teams of 50+ with admin hierarchies
- Not a system that requires training to use

We are a focused tool for people who get leads from social media and need to manage them simply and fast.

More features ≠ more value. Clarity = value.

---

## 10. REAL LIFE SCENARIO

**Without the system:**

It's 9am. A sales rep has 3 new WhatsApp messages, 2 Instagram DMs, and a Facebook lead form submission from overnight. They copy the names into an Excel sheet — but miss one. They call two people. The third gets forgotten. A week later, a potential customer messages "I never heard back" — and the deal is gone.

**With the system:**

Every lead — regardless of source — lands in one list. Each has a name, source, and status. The rep opens the system, sees who is "new", and starts calling. Nothing is forgotten. Nothing is buried in a chat.

---

## 11. SUCCESS LOOKS LIKE

A successful user:

- Opens the system every morning instead of scrolling through WhatsApp
- Sees exactly which leads need follow-up today — no guessing
- Updates a lead's status in seconds after a call
- Has not lost a lead to "I forgot" in weeks
- Does not need to think about where to find their leads — they just know

The system becomes their daily habit, not a tool they have to remember to use.

---

## 12. ANTI-PATTERNS

Avoid building or designing anything that causes:

- **Empty screens with no action** — if the user has no leads, show them exactly how to add or import one
- **Complexity before value** — don't ask for configuration, settings, or onboarding steps before the user sees their leads
- **Features that don't serve the 4 main actions** — adding, importing, assigning, tracking
- **Multi-step flows for simple tasks** — adding a lead should take under 10 seconds
- **Unclear status labels** — every lead status must be obvious: new, contacted, closed, lost
- **Any UI that makes the user think** — if they have to figure it out, it's already wrong

## Core Data Model

There is only ONE entity in the system: Lead.

"Client" is not a separate entity.
It is a Lead with status = "closed".
