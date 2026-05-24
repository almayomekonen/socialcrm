# Winning Angles

The narrative frames we run campaigns on. A hook is a sentence. An angle is a story that holds up across a landing page, an ad sequence, an email drip, and a sales conversation.

Five angles, each grounded in something real about the product.

---

## Angle 1 — "WhatsApp is killing your sales"

**The story:**
You think WhatsApp is your sales tool. It's actually where your leads die. Every morning you open it, see 40 messages, and three of them were leads you've already forgotten. You're not bad at sales. Your tool is bad at sales.

**Why it works:**
The persona lives in WhatsApp all day. They don't *see* the problem until you name it. This angle reframes their default behavior as the cause of their pain — not external, internal.

**Proof points from the product:**
- One unified leads list across sources.
- Status field per lead so nothing is "I think I replied."
- SLA hours surfaced on the table — the system tells you what's overdue.
- AI summary on every lead so you don't reread the chat history.

**Where it runs:** TikTok / Reels (screen recording of a chaotic WhatsApp → cut to the leads table), Facebook ads to small business owners, cold email subject lines.

**Sample copy:**
> כל בוקר אתה פותח את הוואטסאפ ורואה 40 הודעות. שלוש מהן היו לידים. אתה כבר לא זוכר אילו.

---

## Angle 2 — "Excel was never a CRM"

**The story:**
The spreadsheet worked when you had 12 leads. It stopped working at 50. Now you have 200 rows, no order, no statuses, and the column "did I call them?" is empty for the last 60. You don't need a more powerful Excel. You need to stop using Excel.

**Why it works:**
Most of the target audience is currently using Excel and *believes* it's working. The proof that it isn't is in their own behavior — and we surface it.

**Proof points from the product:**
- Excel import — the user keeps their data, gains structure.
- Status workflow, SLA hours, last-action timestamps.
- Filter, sort, search built in. No formulas to maintain.
- Export back to Excel any time — no lock-in fear.

**Where it runs:** Landing page (`crm-vs-excel/page.tsx` already exists — invest here), comparison content, retargeting for "Excel CRM" searchers.

**Sample copy:**
> הגיליון שלך עובד מצוין. עד הליד ה־50. אנחנו בנינו את מה שמתחיל שם.

---

## Angle 3 — "Your AI sales partner, not your AI dashboard"

**The story:**
Every CRM is adding "AI" — a chatbot, an autocomplete, a vague "smart insights" box. Ours actually reads the lead's history, summarizes it, drafts your follow-up, and tells you the next step. You open the lead and you already know what to do.

**Why it works:**
Differentiates from the noise. The Lead Intelligence Card is a *visible* AI artifact, not buried in a settings page. The Copilot panel is the user's actual workflow, not a marketing demo.

**Proof points from the product:**
- Lead Intelligence Card on every lead — summary, two insights, suggested next action, confidence.
- Copilot panel with three modes (Fast / Smart / Advanced).
- Four wired actions: summary, follow-up draft, next step, ask a question.
- Multi-provider — Anthropic, Google, OpenAI — invisible to the user.

**Where it runs:** Pro upgrade upsell, product-led landing page, Hebrew tech community (LinkedIn, dev podcasts), video demos with real screen recording.

**Sample copy:**
> ה־AI לא יושב באיזה דשבורד נפרד. הוא בתוך כל ליד. כשאתה פותח, אתה כבר יודע מה לעשות.

---

## Angle 4 — "Built for one rep. Ready for eight."

**The story:**
You start alone. You add one rep. Then two. The system already knows: who owns which lead, how to split a commission, what to do when a rep leaves. You don't pay for "team features" because they were there from day one.

**Why it works:**
Removes the "we'll outgrow it" objection. Sells the secondary persona (small team manager) without alienating the primary persona (solo).

**Proof points from the product:**
- Multi-rep deals with percentage splits (`sale_users.prcnt`).
- `transferSales` reassigns a departing rep's entire book in one action.
- Six roles, permission graph, team grouping.
- Internal competitions to drive performance once you have reps.
- Same product, same price tier — no "enterprise upsell."

**Where it runs:** Outreach to managers, in-app for users who added a second seat, post-signup email to anyone who imported >100 leads.

**Sample copy:**
> נציג עזב? כל הלידים שלו עוברים בלחיצה אחת. סגרת עסקה בשניים? המערכת כבר חישבה את החלוקה.

---

## Angle 5 — "60 seconds to your first 'oh, this actually helps'"

**The story:**
You imported your Excel. The leads appeared. You saw who was new, who was waiting, who was cold. For the first time in months, you felt in control. That moment happens in 60 seconds. No onboarding consultant. No setup call. No "let's schedule a demo."

**Why it works:**
Most CRM evaluations die in the demo-request stage. This angle is anti-demo. It tells the user the product works on their own laptop, today, without a phone call.

**Proof points from the product:**
- Excel import flow that lands leads in the table immediately.
- Empty state with one prominent CTA.
- Hebrew-native UI — no localization friction.
- Free tier with 50 leads — enough to evaluate without paying.

**Where it runs:** Pricing page, "try it now" CTAs, anti-demo landing variant, performance ads with "no demo required" emphasis.

**Sample copy:**
> בלי דמו. בלי שיחת היכרות. בלי הטמעה. תעלה את האקסל שלך — תוך דקה תראה את הלידים מסודרים.

---

## Angle deployment plan

| Stage of funnel | Angle to lead with |
| --- | --- |
| Cold traffic — paid social | Angle 1 (WhatsApp) or Angle 2 (Excel) |
| Comparison searchers | Angle 2 (Excel) or Angle 5 (60 seconds) |
| Landing page A/B test | Angle 3 (AI partner) vs Angle 5 (60 seconds) |
| Free → Pro upsell in-app | Angle 3 (AI partner) |
| Outreach to small teams | Angle 4 (built for 1, ready for 8) |
| Retargeting visitors who didn't convert | Angle 5 (no demo) |

---

## Angles we do NOT run

- "The most powerful CRM" — false. We chose to be simple.
- "All-in-one business platform" — false. We are focused on leads.
- "AI-powered intelligence" without specifics — meaningless.
- "Trusted by 10,000+ businesses" — we don't have the number. Don't fake it.
- Any angle that requires a demo, a sales call, or a quote to act on.

---

## The unifying truth

Every angle ladders back to one promise:

> "Nothing fell through the cracks today."

If a campaign doesn't end at that feeling, it's the wrong campaign.
