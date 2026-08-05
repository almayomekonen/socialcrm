# onboarding-activation-strategy.md — Should Facebook gate the product?

**Status:** strategic review. No code, no schema, no plan. Decision input.
**Question:** is requiring a Facebook Page connection before dashboard access strategically
correct?
**Authority:** subordinate to `CLAUDE.md`, `care-charter.md`, `product.md`, `ux-guidelines.md`.

---

## 0. The one-paragraph answer

The gate is **strategically wrong**, but not for the reason you think. The problem is not that
Facebook is a high-friction step — it is that the gate blocks the moment `product.md` itself
names as the first success moment (the Excel import), blocks the trial that funds the company,
and trains your Meta ad algorithm to find you *only* the customers who would have converted
anyway. Meanwhile the alternative onboarding you would need is **already built and already
unreachable**. The strongest argument for keeping the gate — "an empty CRM is a dead CRM" — is
real, and the current gate is *worse at satisfying it* than the flow it blocks, because a fresh
Page connection delivers zero leads today and an Excel import delivers hundreds in sixty seconds.
Remove the requirement. Keep the Facebook connection as the loudest, most prominent, contextually
offered action inside the product. Confidence: **high**.

---

## 1. Ground truth — what the code actually does

I read the gate rather than assuming it. Five findings reorder everything below.

### 1.1 The gate is already decoupled from Facebook

`app/(app)/layout.tsx:42` — `if (!(await isOnboarded(user.agencyId))) redirect('/activate')`.
`isOnboarded()` reads exactly one column: `agencies.onboardingCompletedAt`. Its own file comment
says it *"deliberately never queries facebook_pages or any integration table, so the gate stays
decoupled from FB/WhatsApp/Instagram/imports forever."*

The gate is generic. What makes it a Facebook gate is that **the only writer of that flag is the
Facebook-connect success path** (`useActivationController.ts:79`, after a 200 from
`/api/auth/facebook/connect`; and `ActivationExperience.tsx:41`, on the same completion state).

**Consequence:** opening the product is not a re-architecture. Someone already built the seam.
The strategic decision is expensive; the change is not. This inverts the usual "is it worth the
engineering cost" calculus — the cost is near zero, so the decision should be made on strategy
alone.

### 1.2 There is a second gate, and it is bigger than the Facebook one

`app/(app)/layout.tsx:40` — `if (await isMobileRequest()) redirect('/activate')`.

**Every mobile user is permanently redirected out of the product**, before the onboarding check,
forever — including users who already connected. `/activate` shows them a "copy this link and
open it on a computer" hint (`ActivatedHint`, `DESKTOP_HINT_COPY`).

You asked about Facebook. For plumbers, restaurant owners, gym managers and field sales reps —
the exact segments you named — **the mobile block excludes more people than the Facebook block
does**, and it excludes them *after* they have paid the Facebook tax. It is invisible in your
funnel because those users look identical to Facebook-abandoners.

I am not recommending you build a full mobile CRM. I am saying you have two gates, you are
optimizing the smaller one, and the interaction between them means your abandonment data cannot
distinguish "wouldn't connect Facebook" from "was on a phone."

### 1.3 The trial — and therefore all revenue — is behind the gate

`WelcomeTrialModal` renders in `app/(app)/layout.tsx:103`, only when `trialStatus ===
'NEVER_STARTED'`. That layout redirects un-onboarded users away at line 42, before it renders.
Trial start is a click on that modal's CTA (`actions/trial.ts` → `startTrial`).

Therefore: **no Facebook Page → no trial → no `trial_started` → no `subscription_activated`.**

The entire monetization funnel is downstream of owning a Facebook Business Page. This is the
single most consequential fact in the review, and it is not a Facebook-strategy question at all —
it is a "does the company have a business model for non-Meta businesses" question. Today,
structurally, it does not.

### 1.4 The non-Facebook onboarding is already built — and unreachable

`components/clients/LeadsFirstRun.tsx` takes `metaConnected` and `whatsappConnected` props. Its
`metaConnected === false` branch renders **חבר את העסק שלך** with four equal cards: WhatsApp
(badged מומלץ), Facebook/Instagram, **הוסף ליד ראשון**, and **ייבוא מאקסל**.

That is, precisely, the correct onboarding for a lawyer, an accountant, a gym or a plumber. It
exists. It is good. It follows `ux-guidelines.md` §4 exactly.

**No user without a Facebook Page can ever see it**, because the layout gate fires first. You
built the answer and locked it behind the problem.

### 1.5 The instrumentation encodes the same assumption as the gate

`lib/analytics/track.ts` has a rich funnel: `registration_completed`, full `facebook_*` and
`whatsapp_*` connect funnels, `trial_started`, `subscription_activated`,
`activation_first_real_lead`, `meta_capi_lead_sent`.

What it does **not** have: manual lead created, CSV/Excel imported, dashboard viewed, first lead
status change, first follow-up scheduled. And `trackFirstRealLeadOnce()` is typed
`integration: 'facebook' | 'whatsapp'` — **"first delivered value" is definitionally impossible
without an integration.**

**Consequence:** if you remove the gate today, your dashboards will show activation *falling*,
because the only activation you can measure is the kind the gate was forcing. You would be
flying blind into exactly the moment you most need instrumentation. This is a sequencing
constraint, not a reason not to act — see §10.

### 1.6 Meta has no revenue-proximate signal at all

- `CompleteRegistration` — browser Pixel, fired on `/activate` load (`RegistrationPixel`).
- `Lead` — server CAPI, fired at the `facebook_pages` upsert. Well-built: per-agency
  idempotency marker, deterministic `event_id`, `after()` scheduling, no competing Pixel `Lead`.
- `trackStartTrial` and `trackSubscribe` exist in `lib/facebook/pixelEvents.ts` and are
  **called from nowhere**. Verified: zero usages outside their own definitions.

So Meta currently optimizes against registration (cheap, noisy) and Facebook-connection (the
subject of this review). The two events closest to money are dark.

---

## 2. Product-market fit and friction

### Does the onboarding create unnecessary friction?

The friction is not the click count. It is the **eligibility requirement**. A three-click OAuth
is cheap for someone who qualifies and infinite for someone who does not. This gate does not slow
users down; it filters them out.

### Who benefits

Honestly, three parties do:

1. **Meta-advertising customers** — they get a working, populated product on day one with zero
   manual effort. For this segment the gate is genuinely good onboarding.
2. **The Meta ad campaign** — a clean, high-intent conversion signal (§9).
3. **Engineering** — one path, one state machine, no branching, no "what does an empty CRM look
   like" problem to solve.

Do not dismiss (3). Single-path onboarding is why the code is as clean as it is.

### Who is excluded

| Excluded population | Why | Recoverable later? |
| --- | --- | --- |
| No Facebook Business Page | Nothing to connect | Only if they create one — high effort, low intent |
| Has a Page, is not an admin | The agency / a former employee / a nephew owns it | Days to weeks |
| Admin, but declines `leads_retrieval` | Meta lets users uncheck scopes — your code explicitly handles this | Same session, but the flow reads as failure |
| Runs Meta ads, but not Lead Ads | Traffic/conversion campaigns have no leadgen forms | Never — they have a Page but no reason to connect it |
| Mobile evaluators | §1.2 — blocked regardless | Never, on that device |
| Wants to look before connecting | No skip. The screen is explicitly designed with *"No progress indicator, no skip"* | Never |

The last row is the expensive one. **The person who registers and does not connect is not
disqualified — they are frequently qualified but not ready in that ninety seconds.** A lawyer
evaluating three CRMs on a Tuesday afternoon does not stop to create a Facebook Business Page.
They close the tab and open Pipedrive.

### Who abandons

Your `activation_abandoned` event already exists. So does `onboardingCompletedAt`. You can size
this exactly, today, without shipping anything:

```sql
SELECT
  count(*) FILTER (WHERE "onboardingCompletedAt" IS NOT NULL) AS entered_product,
  count(*) FILTER (WHERE "onboardingCompletedAt" IS NULL)     AS never_entered
FROM agencies;
```

Cross-referenced with `analytics_events` for `activation_started` (clicked connect) vs. never
started, that splits abandoners into **"tried and failed"** (a fixable UX/permissions problem)
and **"never tried"** (an eligibility problem — the subject of this review). Those two require
opposite responses. Do this query first. Confidence that it changes the *urgency* of everything
below: **high**. Confidence that it changes the *direction*: **low** — the direction is
determined by §1.3 and §1.4 regardless of the numbers.

### The steelman for keeping the gate, and why it fails

The strongest argument is not "Facebook is our niche." It is: **an empty CRM is a dead CRM.** A
user who reaches a dashboard with zero leads gets no value, forms no habit, and churns silently.
Forcing a data connection at onboarding forces the product to be worth something. This is a real
pattern and a defensible strategy.

It fails here for a specific reason: **the gate forces one particular source, not data.**

- A freshly connected Page subscribes to the `leadgen` webhook. It delivers **the next** lead.
  A business that gets four leads a week sees an empty CRM for two days after "completing"
  onboarding.
- An Excel import delivers **two hundred leads in sixty seconds**.

And `product.md` §7 — your own document — defines the first success moment as:

> "They import their Excel file, and within 60 seconds they can see all their leads organized in
> one place."

**The onboarding gate blocks the company's own written definition of the first success moment.**
If the goal is "never let a user reach an empty CRM," the gate is not merely imperfect — it
selects the weaker of the two available instruments and forbids the stronger one.

### The charter conflict

`care-charter.md` §9, on first contact:

> "Ask at most one thing, and let the answer visibly reshape the experience. Infer everything
> else." … "Never run a tour, a checklist, a progress ring, or a configuration step before the
> user has received value."

A mandatory OAuth is a configuration step before value. The current onboarding violates the
binding charter. That is not a rhetorical flourish — per `CLAUDE.md` §13, the charter wins over
feature decisions, and this one was presumably made before the charter existed.

---

## 3. Activation — what the milestone should actually be

Three different things are being conflated under one word. Separate them and the answer resolves.

| Layer | Definition | Purpose |
| --- | --- | --- |
| **Setup** | Any source of leads is established: connection **OR** import **OR** first manual lead | Predicts whether activation is *possible* |
| **Activation** | The agency has leads **and has acted on one** — a status change, a follow-up, an outbound message — within 7 days of registration | The real thing. Predicts retention. |
| **Habit** | Lead actions on ≥3 distinct days in a 7-day window | Predicts payment |

Scoring your candidate list against this:

| Candidate | Verdict |
| --- | --- |
| Registration | **No.** Zero value delivered. It is a cost, not an outcome. |
| Dashboard visit | **No.** Presence is not value. Trivially gameable, predicts nothing. |
| Facebook connection | **No — and this is the core error.** It is a *setup* step, and a source-specific one. It measures "does this business run Meta Lead Ads," not "is this business getting value." It correlates with revenue today only because it is *mandatory* — a tautology, not a signal. |
| First lead (any source) | **Close.** Necessary, not sufficient. A lead nobody touches is a row in a table. |
| Import contacts | **Strong leading indicator.** Highest-value single act available at onboarding: instant populated state, and it is `product.md`'s own first success moment. Not the milestone itself, but the best predictor of it. |
| AI usage | **No.** A feature-usage metric wearing an activation costume. Per `care-charter.md` §11.7 ("whose benefit"), optimizing for AI usage serves the system, not the user. |
| Trial started | **No — it is a billing state, not value.** Today it is also gate-dependent (§1.3), so it currently measures Facebook ownership. |
| Paid subscription | **No.** That is the *outcome*, not the activation milestone. Activation is the thing you move to move it. |

**Recommended activation milestone:** *an agency that created or received ≥1 lead and took ≥1
action on a lead within 7 days of registration.* Source-agnostic by construction.

Confidence: **high** on the three-layer split; **medium-high** on the specific 7-day / 1-action
thresholds, which should be calibrated against your retention data once §10's events exist.

---

## 4. What great SaaS companies actually do

The relevant question is not "do they have integrations" — all of them do. It is: **does any of
them make an external OAuth mandatory before you see the product?**

| Company | Onboarding gate | Where integrations live |
| --- | --- | --- |
| **HubSpot** | None. Free CRM, add a contact manually in ~30 seconds | Settings + contextual prompts, always optional |
| **Pipedrive** | None. 14 days, no card. Asks about your pipeline, drops you in | Marketplace, offered after value |
| **Monday** | **One question** — what do you want to manage — which shapes the first board | Integration center, post-activation |
| **ClickUp** | None. Templates over connections | Settings, opt-in |
| **Notion** | None. Instant workspace | Optional, per-page |
| **Slack** | Workspace creation + invites — *the closest thing to a gate here* | Apps directory, optional |
| **Linear** | Workspace only. Git integration offered later, in context | Settings, and genuinely optional |

**Zero of seven require an external OAuth to enter.** Not one.

Slack is the interesting case and the one worth taking seriously, because it *does* gate: you
must create a workspace and, practically, invite someone. But Slack gates on the thing without
which the product is **definitionally meaningless** — single-player Slack does not exist. The
test that generalizes is:

> Gate only on the one thing without which your product cannot exist at all.

Single-player SocialCRM absolutely exists: a lead list, statuses, follow-ups, an Excel import.
You said so yourself in the brief. So the Slack precedent does not license this gate — it argues
against it.

The genuine counter-examples are pipes, not workspaces: Segment, Amplitude, Zapier all gate on a
data source because a pipe with no input is nothing. **The strategic question underneath your
question is: is SocialCRM a pipe or a workspace?** The gate says pipe. Your brief, `product.md`,
and `LeadsFirstRun`'s unconnected branch all say workspace. You cannot be both, and the current
product contradicts itself. Confidence: **high**.

Monday is the model to copy: one question, no gate, the answer reshapes the first screen. That is
also, near-verbatim, what `care-charter.md` §9 already mandates.

---

## 5. Growth — what each approach maximizes

| Metric | Keep the gate | Remove the gate | Notes |
| --- | --- | --- | --- |
| Registration → product entry | Low | **Much higher** | The most direct effect, and the largest |
| Absolute activations | Lower | **Higher** | Strictly more people can reach value |
| Facebook connections, **as a % of registrations** | **Higher** | Lower | The denominator grows. **This will look like a regression and will not be one.** |
| Facebook connections, **absolute** | Baseline | Flat to higher | Connection moves from a blocker to a benefit, and gains a second, later occasion to happen |
| Trial starts | Structurally capped | **Much higher** | §1.3 — today the trial is unreachable without a Page |
| Trial → paid **rate** | **Higher** | Lower | More trials from a wider funnel dilutes the rate |
| Absolute paying customers | Lower | **Higher** | The only one of these that pays salaries |
| Retention | Slightly higher | Slightly lower, then recovers | Auto-fed CRMs retain better than empty ones — mitigated by §7 |
| Long-term revenue | Capped at the size of the Israeli Meta-Lead-Ads SMB market | **Capped at the size of the Israeli SMB market** | The strategic difference, and it is an order of magnitude |

**The metric trap, stated plainly:** removing the gate makes *two* headline percentages go down —
Facebook-connect rate and trial-to-paid rate — while absolute revenue goes up. If you do not
decide *before* the change which numbers you are optimizing, you will read a successful change as
a failed one within three weeks and revert it. Write the expected direction of every metric down
first. Confidence: **high**, and this is the most common way this specific change gets undone.

---

## 6. UX — the recommended onboarding

**Option A (force Facebook now): reject.** Everything above.

**Option B (dashboard first, connect later): correct in direction, insufficient alone.** Dropping
an unconnected lawyer into an empty dashboard trades an eligibility problem for an empty-CRM
problem. Better, but it leaves value on the table.

**Option D (something else — e.g. reverse-trial, sales-assisted, demo data): reject.** Demo data
is forbidden by `care-charter.md` §9 ("Never fabricate demo data to look populated"). Sales-assist
does not scale for SMB price points. A reverse trial is what you already have.

**Option C — hybrid. Recommended.** Specifically:

```
Landing → Registration
        → ONE question: "איך מגיעים אליך לידים היום?"
        → Product (leads view), first-run state shaped by the answer
        → Connection offered in context, prominently, permanently, never blocking
```

The one question — and it must be exactly one, per charter §9 and the 5-second rule:

> **איך מגיעים אליך לידים היום?**
> - מודעות בפייסבוק ואינסטגרם
> - וואטסאפ
> - ממקומות אחרים (טלפון, המלצות, אתר)

Three options. Not four. Not "I'm just evaluating" — see §7.

What the answer does, and only this:

| Answer | First screen |
| --- | --- |
| Meta ads | `LeadsFirstRun` with Facebook connect as the primary card — effectively today's flow, minus the wall |
| WhatsApp | Same component, WhatsApp primary |
| Elsewhere | Same component, **ייבוא מאקסל** primary, connections present but quiet |

Note what this requires: **a prop change to a component that already accepts props.** Not a new
screen, not a new pattern, not a new layout. `ux-guidelines.md` §12 satisfied by construction.

**Four rules the design must hold:**

1. **The connection never disappears.** It moves from wall to card, permanently available, never
   a dismissed one-time offer. Facebook-connect must remain trivially reachable for the people
   who will eventually want it — a large share of the "elsewhere" segment, later.
2. **`/activate` survives, unblocking.** Keep the route, keep the cinematic screen, keep the
   state machine, keep the CAPI firing point. Add a way out. It becomes the *recommended* path
   for Meta-sourced traffic rather than the *only* path for everyone.
3. **No checklist, no progress ring, no percentage-complete.** Charter §9 forbids it, and it
   converts a workspace into a chore.
4. **The empty dashboard needs an honest state.** `ux-guidelines.md` §11: exactly one page-level
   state at a time. An unconnected user with zero leads must see the first-run state, not a
   dashboard of zeroes — which `CLAUDE.md` §11 already forbids independently.

**A refinement worth testing, not shipping blind:** you already capture `fbc`/`fbclid` for CAPI.
Traffic arriving from a Meta Lead Ad almost certainly *has* a Page; organic and Google traffic
often does not. Use that to set which card is primary — **branch the emphasis, never the gate.**
Two onboarding *paths* is complexity you will regret; one path with a smarter default is free.
Confidence: **medium** — worth an A/B, not worth blocking the main change on.

---

## 7. Segmentation

**Yes, segment — but segment the first screen, not the product.** Three constraints:

1. **The question must change something.** Do not ask for industry. "Lawyer" is vanity data; it
   changes no default, drives no behaviour, and costs you a question you only get to ask once.
   "Where do your leads come from" is the only segmentation that maps to a product decision (which
   connect card leads).
2. **Never create separate onboarding *paths*.** Separate paths mean divergent state machines,
   divergent bugs, and a second `/activate` to maintain. One path, different defaults.
3. **Do not offer "I'm just evaluating."** It is a self-fulfilling low-intent label, it tells you
   nothing actionable, and it invites the user to pre-commit to not caring. **Instead, make
   evaluation the default experience** — an unblocked product *is* the evaluation path. Every
   evaluator self-serves without having to declare themselves one.

Would this improve activation? Yes, but the segmentation is the smaller half of the gain. The
large gain is removing the gate. The question mostly buys you *relevance* of the first screen and
one clean cohort dimension for every metric that follows. Confidence: **high** on the direction,
**medium** on the size of the incremental lift over simply unblocking.

---

## 8. Risks — what breaks

| Risk | Severity | Reality / mitigation |
| --- | --- | --- |
| **Empty-CRM churn** | **High** — the real one | The genuine cost. Mitigation: `LeadsFirstRun` already exists and is good; make Excel import the loudest action for the non-Meta segment. Track "agencies with 0 leads at day 7" as a named guardrail metric. |
| **Metrics appear to regress** | **High** | Two headline rates drop by construction (§5). Requires writing down expected directions *before* shipping. This is the most likely cause of a revert. |
| **Activation looks like it fell** | **High** | `trackFirstRealLeadOnce` is typed `'facebook' \| 'whatsapp'`. Non-integration value is **structurally invisible**. Instrument before removing the gate — see §10 sequencing. |
| **Meta signal volume / timing shifts** | Medium | Detailed in §9. Manageable, and partly an improvement. |
| **`onboardingCompletedAt` semantics change** | Low | It stops meaning "connected Facebook" and starts meaning "finished onboarding." The column is already named for the new meaning; only the writers change. |
| **Support load shifts** | Low-medium | From "I can't get in" to "how do I get leads in?" — a strictly better conversation, but a different one. |
| **Trial economics** | Medium | More trials, lower conversion rate, higher absolute conversions. Only matters if trial has real marginal cost (AI spend). Worth a quick check before, not a blocker. |
| **Loss of the forcing function** | Medium | Some businesses genuinely *should* connect Facebook and will now procrastinate. Mitigation: the connect card stays permanently prominent; a contextual nudge when a lead arrives from an unconnected source. Per charter §10 — one quiet line, in context, never a checklist. |

**What does not break:** the CAPI implementation (untouched), tenancy, permissions, the webhook
path, `transferSales`, the schema. This change touches routing and instrumentation only. That is
unusually safe for a decision this consequential — see §1.1.

---

## 9. Meta Ads — the part that deserves the most care

Your CAPI implementation is genuinely well-built. Per-agency idempotency marker, deterministic
`event_id`, `after()` scheduling so Meta cannot delay a connection, no competing Pixel `Lead`,
hashed PII. **Do not touch it.** Nothing below requires changing `lib/facebook/conversionsApi.ts`
or `metaLeadConversion.ts`.

### The uncomfortable finding

Optimizing for "connected a Facebook Page" tells Meta's algorithm: *find me more people who
already own Facebook Business Pages and run Lead Ads.* Meta is extremely good at this. It will
comply.

**The conversion event is training your ad delivery to exclude the exact segments you named in
the brief** — lawyers, accountants, plumbers, restaurants. The gate does not only exclude them
from the product; it excludes them from your *targeting*. You are paying Meta to avoid your
stated market. Confidence: **high**. This is, in my view, the strongest argument in the entire
review, and it is an argument the gate's defenders cannot address without changing the event.

### What is actually being wasted today

A user who registers and bounces at `/activate` fires `CompleteRegistration` and then nothing. If
`CompleteRegistration` is not your optimization target, that spend produced **no learning signal
at all** — no conversion, no value, nothing for the algorithm to generalize from. Every abandoned
registration is spend converted into silence.

### Volume is probably your binding constraint, not quality

Meta's published guidance is ~**50 conversions per ad set per week** to exit the learning phase.
Below that, delivery stays unstable and expensive regardless of how clean the event is. A
perfectly-modelled event at 8/week is worse for the optimizer than a noisier one at 60/week.

I do not know your volume. This is the second query to run:

```sql
SELECT date_trunc('week', "createdAt") AS wk, count(*)
FROM analytics_events WHERE event = 'meta_capi_lead_sent'
GROUP BY 1 ORDER BY 1 DESC;
```

**The decision rule:** optimize for the **latest-stage event you can reliably generate ≥50/week
of per ad set.** Not the highest-quality one. Not the closest to revenue. The latest one that
clears the volume floor.

### Recommended structure

1. **Keep the Facebook-connect `Lead` CAPI event exactly where it is.** It stays valid after the
   gate is removed — connection still happens, just later and from settings. Confidence: **high**.
2. **Wire the two events you already built.** `trackStartTrial` and `trackSubscribe` exist in
   `lib/facebook/pixelEvents.ts` and are called from nowhere. Firing them costs nearly nothing and
   gives Meta its first revenue-proximate signals. Do this **regardless** of the gate decision.
   Confidence: **high**. This is free money and the gate discussion is not a prerequisite.
3. **Plan to move the optimization target to `StartTrial`** once trial start is no longer
   gate-dependent. It is higher-volume than Facebook-connect, closer to revenue than registration,
   and — critically — **available to every business type**, so it stops teaching Meta to avoid
   non-Meta businesses. Confidence: **medium-high**, contingent on the volume check.
4. **Send `Subscribe` with a value parameter** once wired. Value-based optimization is
   meaningfully better than count-based when it has data. Confidence: **medium** — it needs
   volume to work, and it is the last step, not the first.

### The honest cost

Some Facebook connections will now happen days after the click, falling outside the 7-day-click
attribution window. Those conversions become unattributable, so **reported** CAPI conversions may
drop even as **actual** connections rise. Expect this. It is another instance of §5's metric trap,
and it is the one place where the gate's defenders are factually right about a real loss. The
trade is: a narrower, better-attributed signal versus a wider, partly-unattributed one that
includes segments the narrow signal structurally cannot reach.

---

## 10. Data — the events to track

### Already implemented

`registration_completed`, `welcome_modal_shown`, `trial_started`, `trial_expired`,
`upgrade_clicked`, `subscription_activated`, the complete `facebook_*` and `whatsapp_*` connect
funnels, `activation_first_real_lead`, `meta_capi_lead_sent`, `activation_started` /
`oauth_completed` / `activation_abandoned`.

This is a good taxonomy. The gap is not depth — it is that **every value event requires an
integration**.

### Missing — and required before the gate is removed

| Event | Why it is not optional |
| --- | --- |
| `dashboard_first_viewed` | The denominator for every in-product metric. Today unmeasurable, because entry is gated. |
| `lead_created_manual` | One of your four core actions (`product.md` §6) and currently invisible. |
| `leads_imported` (with `count`) | The company's own first success moment (`product.md` §7) is untracked. |
| `lead_action_taken` (status change / follow-up / message) | **The activation milestone from §3.** Nothing else can serve as North Star input. |
| `onboarding_question_answered` (with the answer) | The segmentation dimension for every metric below. |
| `connection_offered` / `connection_deferred` | Distinguishes "chose not to connect" from "never saw the option" — the single most important diagnostic after the change. |

**Also required:** widen `trackFirstRealLeadOnce`'s `integration` parameter beyond
`'facebook' | 'whatsapp'` to admit `'manual' | 'import'`, or add a parallel source-agnostic
first-value event. As written, the type system enforces the assumption you are trying to remove.

**Sequencing, and this is the one hard constraint in this document:** ship the instrumentation
**before** removing the gate. Not after, not simultaneously. You need at least a two-week baseline
of the new events under the old regime, or you will have no way to distinguish "the change
worked" from "we started measuring different things." Confidence: **high**.

### North Star

**One North Star:** **Weekly Active Lead-Working Agencies** — agencies that took ≥3 lead actions
in the last 7 days.

Why this one:
- **Source-agnostic** — a Facebook agency and a lawyer with an Excel file count identically.
- **Value-true** — it measures the product doing its job, not the user being present.
- **Charter-aligned** — it is a direct measurement of `care-charter.md` §9's morning loop, and it
  cannot be inflated by the engagement-maximizing behaviours §13.1 explicitly forbids.
- **Revenue-predictive** — an agency working leads weekly renews; an agency with a connected Page
  and no activity does not.

**Three input metrics** (the things you actually move):
1. Registration → first lead in system (any source), within 24h
2. First lead → first lead *action*, within 7d
3. Week-1 → week-4 retention of lead-working behaviour

**Two guardrails** (the things that must not degrade):
1. **% of agencies with zero leads at day 7** — the empty-CRM risk the gate was protecting
   against. If this climbs, the gate's defenders were right and the mitigation was too weak.
2. **Absolute weekly Facebook connections** — must not fall. The *rate* will; the count must not.

**Explicitly not North Star:** registrations, dashboard visits, Facebook connections, AI usage,
session length, trial starts. Each is either a cost, a setup step, a vanity metric, or —
per charter §13.1 — an engagement metric this company has already committed in writing not to
optimize.

---

## 11. Final recommendation

**If SocialCRM were my company, this is what I would build, in this order:**

**Phase 0 — measure (days, no product change).** Run the two queries in §2 and §9. Size the
abandoned population and split it into "tried and failed" vs. "never tried." Establish weekly CAPI
conversion volume against the 50/week floor. This does not change the decision; it changes how
loudly you should be running.

**Phase 1 — instrument (before anything else ships).** Add the six missing events from §10.
Widen the `integration` type. Wire `trackStartTrial` and `trackSubscribe`, which already exist and
fire nowhere. Two weeks of baseline. **Non-negotiable ordering.**

**Phase 2 — unblock.** Write `onboardingCompletedAt` on any of: Facebook connect (today's path),
WhatsApp connect, first Excel import, first manual lead, **or an explicit skip on `/activate`**.
Keep `/activate` and the CAPI firing point untouched. Add the one segmentation question. Route the
answer into `LeadsFirstRun`'s existing props. Make the connect card permanent and prominent, never
a wall.

**Phase 3 — watch the guardrails for four weeks.** Specifically: zero-leads-at-day-7, and absolute
Facebook connections. Do not react to the two rates that will drop by construction (§5). If
zero-leads-at-day-7 climbs, the answer is a better import path, not a restored gate.

**Phase 4 — move the Meta optimization target to `StartTrial`**, once trial start is
gate-independent and the volume check clears.

**Separately, and not part of this decision: audit the mobile redirect (§1.2).** It is plausibly
costing you more customers than Facebook is, it is invisible in your current funnel, and you did
not ask about it. That does not mean it is not the bigger problem.

### Confidence table

| # | Recommendation | Confidence | What would change my mind |
| --- | --- | --- | --- |
| 1 | The Facebook gate is strategically wrong and should be removed | **High** | If ≥80% of registrations already connect, this is a rounding error and the gate is fine — run the §2 query |
| 2 | The trial being behind the gate (§1.3) is the most consequential fact here | **High** | Nothing. It is structural. |
| 3 | The CAPI event trains Meta to exclude your stated market (§9) | **High** | Only if you decide the stated market is wrong and Meta-advertisers *are* the business |
| 4 | Instrument before unblocking; two-week baseline | **High** | Nothing. Doing it in the other order destroys your ability to read the result. |
| 5 | Wire `trackStartTrial` / `trackSubscribe` now, independent of everything else | **High** | Nothing. It is built and dark. |
| 6 | Activation = lead in system **+** action taken, within 7 days | **High** on the shape, **medium-high** on thresholds | Retention data disagreeing with the 7d/1-action cut |
| 7 | North Star = Weekly Active Lead-Working Agencies | **High** | If early retention proves uncorrelated with weekly lead actions |
| 8 | One segmentation question, three options, evaluation is the default path | **High** on direction, **medium** on lift size | If the question measurably depresses completion, drop the question and keep the unblocking |
| 9 | Keep the Facebook-connect CAPI event exactly as-is | **High** | Nothing — it is well-built and stays valid |
| 10 | Move the optimization target to `StartTrial` | **Medium-high** | The §9 volume check showing `StartTrial` also lands under 50/week |
| 11 | Branch the *emphasis* on `fbclid`, not the gate | **Medium** | A/B result. Do not block Phase 2 on it. |
| 12 | Empty-CRM churn is the one real risk, mitigated by import-first | **Medium-high** | Guardrail 1 climbing in Phase 3 |
| 13 | The mobile redirect may cost more than the Facebook gate | **Medium** | Device-split registration data — which you should pull, and which I have not seen |
| 14 | Do not add "I'm just evaluating" as a segmentation option | **Medium-high** | If sales genuinely uses intent labels to prioritize outreach today |

### The single sentence

You built a Meta Lead Ads onboarding funnel and then decided you were building a CRM, and the
product has not been told yet — the non-Facebook onboarding is already written, already good, and
already unreachable, and one column write is the only thing standing between it and every customer
you say you want.

---

## Appendix — incidental findings while reading

Not part of this review; noted because they violate binding rules in files I read.

- `components/activation/ActivationExperience.tsx:100` — `סביבת העבודה שלך מוכנה 🎉` contains an
  emoji. `CLAUDE.md` §12 and `frontend-experience-guidelines.md` §22: no emoji in product UI.
- `components/clients/LeadsFirstRun.tsx` — `העבר את כל הלקוחות בשניות` (both branches) uses
  `לקוחות`. `ux-guidelines.md` §6 forbids `לקוח`; the term is `לידים`.
