# ai-product-philosophy.md — Why AI Exists in SocialCRM

> **Governed by the constitution.** [`intelligence-constitution.md`](./intelligence-constitution.md) is the supreme, immutable doctrine for what the AI fundamentally *is*. This doc is the applied strategic layer beneath it and must conform to it; where the two ever disagree, the constitution wins and the conflict must be explicitly resolved (Article 0).

This doc owns the **strategic stance**. It does not contain writing rules, code rules, or roadmaps — those live in their own docs.

If you are about to add an AI surface, read this first to calibrate taste. If the surface you are designing does not match this stance, do not build it.

---

## 1. POSITIONING — WHAT AI IS HERE

AI in SocialCRM is an **operational layer**, not a conversational one.

It exists to do one thing: **let the user act on a lead in seconds, with full context, without thinking**.

It is closer to:

- a sharp sales manager glancing at a lead and saying "this one's been quiet two weeks, call them today"

than to:

- a chatbot waiting for instructions
- a copywriter generating long summaries
- an autonomous worker doing things on the user's behalf

> **Rule:** every AI surface must save the user real seconds in their actual workflow. If it doesn't, it doesn't ship.

---

## 2. CORE PRINCIPLES

### 2.1 Operational intelligence, not conversational intelligence

AI shows up where the work is, says what matters, and gets out of the way. It does not invite a conversation.

- **Yes:** an inline card on the lead page that says "המעקב נחלש בשבועיים האחרונים. תזמן שיחת חידוש קשר."
- **No:** a chat panel that asks "How can I help you with this lead today?"

### 2.2 Conclusions, not narration

AI produces **conclusions a sales manager would draw**, not descriptions of CRM state.

- **Yes:** "אין משימה פתוחה למעקב למרות שהליד עדיין חדש."
- **No:** "The lead has a status of 'open' and was created 3 days ago. There are 0 tasks."

The user already has the dashboard. The AI's job is the layer above the dashboard — the layer that says "here is what this means."

### 2.3 Proactive, but restrained

AI is allowed to surface unprompted insights — but only inside surfaces the user is already looking at.

- AI may **highlight** something on a page the user opened.
- AI must not **interrupt** the user with notifications, popups, modals, or banners they didn't ask for.
- AI must not **pile up** — one AI surface per user view, unless explicitly justified.

### 2.4 Perceived intelligence over flashy intelligence

The product feels intelligent because:

- it loads instantly when warm
- it shows the right thing on the first attempt
- it stays quiet when it has nothing to say

It does **not** feel intelligent because:

- a typing cursor blinks
- text streams in word-by-word
- a glowing gradient pulses in the corner

The fastest way to feel premium is to feel **calm**.

### 2.5 Calm, premium, non-gimmicky

Reference vibe: Linear, Notion AI inline, Gmail's quiet AI hints. **Not** ChatGPT. Not Microsoft Copilot Clippy moments. Not "Bolt-AI"-style flourish.

If a design choice would feel out of place in Linear's UI, it is out of place here.

### 2.6 AI as workflow acceleration

AI does not become its own feature. AI **accelerates existing features**:

- the lead detail page already exists → AI adds an intelligence card
- the today list already exists → AI surfaces what to call first
- the lead import already exists → AI may, eventually, suggest priority

AI never gets its own page, its own dashboard, or its own dock — until the rest of the product is so saturated with intelligence that giving it a home is justified. We are not there. We will not pretend we are.

### 2.7 Avoid enterprise sludge

Our users are small business owners and reps managing leads from WhatsApp and Instagram. They do not have a "pipeline review meeting." They do not have a "sales enablement team."

The AI must speak to them, not to a Salesforce admin. → see [`ai-editorial-guidelines.md`](./ai-editorial-guidelines.md), §3.

### 2.8 Avoid AI gimmicks

The following are explicitly off-brand for this product:

- "AI assistant" framing — there is no assistant. There is the product.
- Personality, names, mascots, characters
- Streaming cursors, typing simulators
- Sparkle icons, gradient backgrounds, "magic" copy
- Confidence theater (e.g. "I'm 87% certain") — see [`ai-safety-boundaries.md`](./ai-safety-boundaries.md), §3
- Faked agency: "I noticed…", "I think…", "let me…"

---

## 3. WHAT AI REPLACES

A new AI surface is justified only if it removes one of these from the user's day:

1. **The "what was happening with this lead?" recall problem** — scrolling tasks/notes to reconstruct status.
2. **The "who do I call first?" prioritization problem** — staring at a list of 40 leads with no signal.
3. **The "did I follow up?" anxiety problem** — not knowing what fell through.
4. **The "what should I say?" composition problem** — only when this becomes a real surface, not now.

If a proposed surface doesn't replace one of these, it doesn't ship.

---

## 4. WHAT AI MUST NOT BECOME

- A **chatbot**. There is no chat dock, no chat page, no conversational thread.
- A **copywriter**. AI does not write user-facing marketing material, long-form notes, or essays.
- An **autonomous worker**. AI does not perform mutations on the user's behalf without an explicit click. → see [`ai-safety-boundaries.md`](./ai-safety-boundaries.md), §2.
- A **second product inside the product**. AI must remain _inside_ existing surfaces, not parallel to them.

---

## 5. THE TASTE TEST

Before adding any AI surface, ask:

1. Does this surface produce a **conclusion** a sharp sales operator would have produced?
2. Would a calm, premium SaaS product (Linear, Notion) ship this exact interaction?
3. Will the user act faster _because_ this is here?
4. If the AI silently fails today, does the page still work without confusion?

If any answer is "no" or "not sure" — do not ship.

---

## 6. RELATIONSHIP TO PROJECT DOCTRINE

This doc extends, never overrides:

- `CLAUDE.md` §3 (UX principles), §8 (decision rule), §10 (what not to build)
- `product.md` §5 (core value: clarity), §12 (anti-patterns)

If this doc and project doctrine ever appear to conflict, project doctrine wins. AI is a feature inside this product, not the product itself.
