# ai-ux-principles.md — How AI Looks and Behaves in the UI

This doc owns the **interface layer** of AI surfaces. Output text is owned by editorial; trust is owned by safety; code is owned by architecture.

The reference vibe: Linear's quietness, Notion AI's inline restraint, Gmail's gentle hints, Cursor's calm loading. **Not** ChatGPT, not Copilot, not anything with a sparkle icon.

---

## 1. WHERE AI LIVES IN THE UI

> **AI lives where context already lives.**

AI does not get its own page. It does not get its own dock. It does not get its own tab.

- The lead intelligence card lives **on the lead detail page**, where the lead's data is.
- A future "today" insight lives **inside the today list**, where the user is already prioritizing.
- A future compose assist lives **inside the compose field**, where the user is already typing.

If a proposed AI surface needs its own URL, it's the wrong surface. Find the page that already has the context.

---

## 2. ONE PRIMARY SURFACE PER VIEW

A single screen has, at most, **one** AI surface vying for attention.

A refresh button on an existing AI card is not a second surface. A small chip ("AI suggestion") on a list row is not a second surface, as long as it leads back to the same primary card.

If a screen would have two independent AI surfaces, ask: which one am I actually building? Build that one. Cut the other.

→ See [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §9 (never overwhelm).

---

## 3. PERCEIVED INTELLIGENCE > FLASHY INTELLIGENCE

The fastest way to feel intelligent is to feel **instant** and **right**.

- Warm cache hit on second view → AI feels alive and aware.
- Cold path with a thoughtful skeleton → AI feels like it's actually working.
- Streaming a token-by-token cursor → AI feels like a chatbot. Don't.

We invest in:

- pre-warming, so most opens are warm
- skeletons that reflect future content layout (not generic spinners)
- subtle calm motion on cold paths (rotating analysis hints, breathing placeholder bars)

We do not invest in:

- streaming token cursors
- typing-dot animations
- "AI is thinking..." anthropomorphic copy
- gradients, sparkles, glows, particle effects

→ See `LeadIntelligenceCardSkeleton` ([`components/ai/LeadIntelligenceCardSkeleton.tsx`](../../components/ai/LeadIntelligenceCardSkeleton.tsx)) as the canonical loading example.

---

## 4. LOADING STATES — THE THREE PATHS

| Path                   | When                 | UX                                                                                                                |
| ---------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Warm**               | Cache hit            | Render immediately. No skeleton.                                                                                  |
| **Cold (server-side)** | First view, no cache | Suspense fallback shows the calm skeleton with rotating Hebrew analysis hints. ~2–4s.                             |
| **Refresh**            | Manual refresh       | Button enters a "מרענן…" state. Card stays visible (do not flash to empty). On success, content updates in place. |

Hard rules:

- **No layout shift** between skeleton and final content. The skeleton has the final content's height and overall structure.
- **No spinner-only states.** A bare spinner says "the system is loading something." A thoughtful skeleton says "the system is preparing something specific for you."
- **No flickering to empty** on transient errors. Previous content stays visible until either a fresh result or a deliberate empty state arrives. → see [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §11.

---

## 5. MOTION

### Allowed

- Slow opacity transitions (~250–400ms) on first content reveal.
- Stagger reveal of card sections (summary → insights → action) with ~80–120ms offsets.
- Calm "breathing" animation on placeholder bars during loading (~2s cycle).
- Subtle rotating text on the loading skeleton (~3s per phrase, fade in/out).

### Forbidden

- Typing-cursor simulators
- Streaming token reveal
- Anything pulsing, glowing, or shimmering at high frequency
- Gradient sweeps across loading bars
- Bouncy/elastic easing
- Animation on confidence pills, badges, or status chips
- Any animation lasting longer than the content read time

### Always

- Respect `prefers-reduced-motion: reduce` — animations freeze, content still appears.
- Animations must not cause layout shift mid-render.

---

## 6. CONFIDENCE AS A UI ELEMENT

`confidence` is not a paragraph. It is a small, calm visual signal.

- A pill or chip near the card title or footer.
- Three discrete states only: `low` / `medium` / `high`.
- Visual differentiation must be subtle: muted gray for `low`, neutral for `medium`, slightly stronger emphasis for `high`. Never red/yellow/green — that would imply alert semantics.
- The pill is hoverable for the localized label ("ביטחון: בינוני") but does not need a tooltip explaining what confidence means.

A `low` confidence card may also visually de-emphasize itself slightly (slightly muted body text, no emphasized borders). The card stays present, just quieter.

---

## 7. EMPTY INSIGHTS — MATURE, NOT BROKEN

When `keyInsights` is empty, the card does **not** render an empty bullet list, a placeholder dash, or an apologetic line ("אין תובנות זמינות כעת"). It simply omits the section.

The card still has:

- summary
- suggested next action
- sources
- confidence

The user sees an honest, calm card. No suggestion that something is missing or broken.

---

## 8. REFRESH AS A MANUAL CONTROL

The "רענן תובנות" button is the only way for AI to regenerate while the user is on the page.

- It is a **secondary** control: small, beside the card title, never visually competing with the card content.
- It is rate-limited (3/user/lead/hour). On rate-limit, it shows "נסה שוב בעוד דקה" inline — not a toast.
- Auto-refresh is forbidden while the user is reading the card. AI does not regenerate behind the user's back. → [`ai-safety-boundaries.md`](./ai-safety-boundaries.md) §2.

---

## 9. PROGRESSIVE DISCLOSURE

The card shows everything important by default. There is no "show more" toggle on the primary content.

When AI surfaces grow (multi-card layouts, lists), use progressive disclosure carefully:

- Start with the **summary** layer always visible.
- Allow drill-down only into **specific entities** (e.g. clicking an insight that mentions a task → opens the task).
- Never use "expand to see AI's reasoning" — that's chain-of-thought theater. The reasoning lives in `sources`. That's enough.

---

## 10. MOBILE

Most users are on phones, often between calls. AI must not push core actions below the fold.

- The intelligence card sits **after** the lead's primary identity (name, status, phone) and **before** task lists or activity logs.
- On narrow viewports the card collapses to a single column with no horizontal scroll.
- Insights chips and source pills wrap, never truncate with "...".
- The refresh button remains tappable (min 44×44 hit area).
- The card never grows so tall that the user has to scroll past it to reach the next-action button on the page (call, message, edit).

---

## 11. ACCESSIBILITY

- The card root has `aria-busy="true"` while loading; a `role="status"` `sr-only` element announces the loading state in a calm sentence ("טוען תובנות חכמות עבור הליד").
- Confidence pills have an accessible label ("ביטחון: בינוני") even if visually they show only the level.
- Sources are read as a list, not a sentence with bullets ("·").
- All AI text supports the page's RTL direction without manual overrides.

---

## 12. NO CHATBOT INTERFACE — EVER

This is the explicit list of UI patterns that are off-brand:

- Floating chat dock / bubble in any corner
- Slide-in side panel labeled "AI Assistant"
- Conversation thread with user/AI bubbles
- "Ask me anything" input at the top of any page
- Persistent AI button in the navigation
- Dismissable AI prompts that re-appear on next visit
- Avatar / mascot / character for AI
- Anthropomorphic copy ("Hi! I'm your AI assistant. How can I help today?")

If a design idea requires any of these, it is the wrong design idea for this product. → see [`ai-product-philosophy.md`](./ai-product-philosophy.md) §4.

---

## 13. THE INTERFACE TASTE TEST

Before approving an AI UI change, ask:

1. Does this look like a Linear / Notion / Gmail surface, or like a chatbot demo?
2. If I removed all AI from the page, does the page still feel complete?
3. Will the user notice this card on mobile, between calls, in 5 seconds?
4. Does the loading state feel calm, or does it feel like waiting?
5. Does the empty state feel mature, or does it feel like a bug?

If any answer is "I'm not sure" — do not ship.
