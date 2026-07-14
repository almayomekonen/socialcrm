# frontend-experience-guidelines.md — SocialCRM Frontend Experience Specification

**Status:** binding for all UI work. Sits beside `ux-guidelines.md`, `architecture-rules.md`, and `care-charter.md`.

**Authority:** If a feature PR conflicts with these guidelines, the guidelines win unless Product explicitly overrides in writing.

**Relationship to other docs:**

- `ux-guidelines.md` — product clarity, terminology, empty-state content, hierarchy
- `architecture-rules.md` — file size, components, server/client boundaries
- **this document** — how every interaction must _feel_ and behave

**Architecture constraints (non-negotiable):**

SocialCRM is built on Next.js App Router, React Server Components, Server Actions, React Compiler, `cache()`, and `unstable_cache()`. Experience improvements must work _with_ this stack. Do not introduce a parallel client data layer (React Query, SWR, Redux, Apollo) to “feel like Linear.” Premium feel comes from disciplined interaction design on top of the existing architecture.

**Product north star:**

A נציג must understand any screen in **5 seconds** and act within **10–20 seconds**. The product should feel as calm and confident as Linear, Attio, Notion, GitHub, and the Vercel Dashboard — without becoming an enterprise toy.

---

## 0. Global principles

1. **Action over spectacle** — every interaction helps manage לידים faster.
2. **Instant acknowledgment** — the UI always responds immediately; the server may catch up.
3. **Shell stability** — navigation chrome stays put; only content regions load or change.
4. **One primary action** — never make two things look equally important.
5. **Trust over cleverness** — silent failures, fake progress, and misleading counts are defects.
6. **Reuse over invention** — same pattern for the same job, everywhere.
7. **Hebrew clarity** — labels and messages use approved terminology (`לידים`, `נציג`); no insurance jargon.

---

## 1. Navigation

### Principle

Navigation is orientation, not decoration. The user always knows where they are, what is unread/urgent, and how to leave.

### Why it matters

Lost navigation kills the 5-second rule. Badge noise creates anxiety without action.

### Good examples

- Sidebar highlights the current section; badge shows a real unread count.
- Deep links preserve filters and selected conversation/lead in the URL.
- Back/forward restores the same list state the user left.

### Bad examples

- Nav items that look selected when they are not.
- Badges that flash then disappear for no reason.
- Navigating away resets filters the user carefully set.

### Never break

- Do not invent a second primary navigation.
- Do not hide לידים / inbox entry points behind nested menus.
- Do not show decorative badges with no actionable destination.
- URL must remain shareable and restorable for list + detail contexts that users work in daily.

---

## 2. Loading states

### Principle

Loading preserves context. The user should never feel the whole app vanished.

### Why it matters

Full-screen spinners erase orientation and make the product feel fragile.

### Good examples

- Nav and page header stay visible while the table body shows placeholders.
- A button shows a spinner on the control that was clicked; the rest of the page remains usable when safe.
- Route transitions replace only the content pane.

### Bad examples

- Full-screen spinner that hides the sidebar.
- Blank white content with no indication of progress.
- Multiple unrelated loading indicators fighting for attention.

### Never break

- Do not blank the entire app shell for ordinary list/detail fetches.
- Do not block the whole page for a single-field save.
- Do not show a global loading toast for high-frequency row actions (status change, mark as read).

---

## 3. Skeletons

### Principle

Skeletons mirror the final layout. They communicate structure before data arrives.

### Why it matters

Structure reduces anxiety. Spinners communicate delay; skeletons communicate “almost ready.”

### Good examples

- Table skeleton with rows/columns matching the real table.
- Inbox list skeleton that matches conversation row height.
- AI card skeleton that matches the intelligence card layout.

### Bad examples

- Generic pulse blocks that do not resemble the destination UI.
- Skeleton and spinner stacked together.
- Skeleton that never resolves into content (stuck loading).

### Never break

- Prefer content-shaped skeletons over full-screen spinners for CRM list routes.
- Skeletons must not invent new layouts; they shadow existing ones.
- Respect reduced-motion preferences: no aggressive pulsing when the user asks for less motion.

---

## 4. Empty states

### Principle

Empty is a guided next step, never a void.

### Why it matters

Empty lists are the most dangerous moment for churn and confusion.

### Good examples

- No leads: clear explanation + primary CTAs **הוסף ליד** / **העלה לידים**.
- Filter returned zero: keep filters visible; explain that filters are active; offer clear filters.
- Inbox with no conversations: explain what connecting WhatsApp unlocks; link to setup.

### Bad examples

- Blank table with headers and no message.
- Illustration-only empty state with no CTA.
- Onboarding banner stacked on top of a full dashboard (two states at once).

### Never break

- Exactly one page-level state at a time (empty system vs filtered empty vs data) — see `ux-guidelines.md`.
- Empty states always answer: what happened, why it matters, what to do next.
- Do not invent a separate “Clients” empty world; closed leads remain לידים by status.

---

## 5. Error states

### Principle

Errors are recoverable, specific, and calm. The user knows what failed and what to do.

### Why it matters

Vague errors destroy trust faster than slow UI.

### Good examples

- “לא ניתן לשלוח את ההודעה. נסה שוב.” with a Retry control.
- Segment error boundary with Hebrew recovery and a way back to לידים.
- After deploy chunk failure: automatic safe reload with a clear recovering message.

### Bad examples

- Silent failure (button un-spins, nothing happened).
- Raw English stack traces or Graph codes shown as the only message.
- Error toast that disappears before it can be read, with no retry path.

### Never break

- Every failed user action needs a visible explanation.
- Destructive failures must not look like success.
- Error copy must be Hebrew, human, and actionable.
- Do not swallow network/sync failures with no UI signal when data may be stale.

---

## 6. Optimistic updates

### Principle

Update the UI first when the outcome is likely and reversible; reconcile with the server; roll back honestly on failure.

### Why it matters

This is the difference between “tool” and “product.” Status changes and sends must feel immediate.

### Good examples

- Lead status changes in the row instantly; server confirms; failure restores previous status.
- Outbound WhatsApp message appears in the thread immediately as pending, then becomes confirmed.
- Dashboard recommended action disappears when completed, with recovery if the server rejects.

### Bad examples

- Waiting for a full page refresh to show a status change.
- Optimistic UI with no rollback path.
- Optimistic UI for irreversible money/legal operations without confirmation.

### Never break

- Optimistic updates are allowed only when rollback is possible or failure is rare and clearly messaged.
- Server remains source of truth; optimism is temporary.
- Do not optimistic-update billing legal issuance or payment mutations.
- Never leave optimistic state that contradicts the server after an error.

---

## 7. Pending states

### Principle

Pending is local and precise. Only the control in motion looks busy.

### Why it matters

Global pending states make the product feel blocked.

### Good examples

- Save button label becomes “שומר…” and disables only that button.
- Send control shows progress; composer stays visible.
- Row-level pending for a single lead action without dimming the whole table.

### Bad examples

- Whole-table opacity for one row delete.
- Global loading toast for every checkbox-like action.
- Double pending signals (toast spinner + button spinner + overlay).

### Never break

- One pending signal per action is enough.
- High-frequency CRM actions prefer inline/optimistic pending over global toasts.
- Disabled controls must still communicate why when it is not obvious.

---

## 8. Forms

### Principle

Forms are short, labeled, and forgiving. Saving is an explicit, understandable action.

### Why it matters

Reps fill forms under time pressure. Ambiguity creates bad data.

### Good examples

- Clear labels above fields; helper text secondary.
- Primary submit uses a specific verb: **שמור שינויים**.
- Validation appears next to the field that failed.

### Bad examples

- Unlabeled purple square “buttons.”
- Errors only in a toast while the invalid field is off-screen.
- Multi-step wizards for a single lead create.

### Never break

- Use existing form controls and button patterns; do not invent new form chrome.
- Required vs optional must be obvious.
- Do not block first value (adding לידים) behind configuration forms.
- Submit labels follow `ux-guidelines.md` specificity rules.

---

## 9. Tables

### Principle

Tables are workspaces for action, not spreadsheets for admiration.

### Why it matters

Most daily work happens in lists. Wrong counts or slow rows destroy confidence.

### Good examples

- Columns that help decide the next call/message.
- Status filters that reflect true server totals.
- Empty and loading states inside the table region, not replacing the whole app.

### Bad examples

- Status tabs that filter only the current page while showing misleading badge counts.
- Pages of meaningless always-zero metrics above the table.
- Horizontal chaos with no primary action column.

### Never break

- Table filters that claim to be global must be server-backed.
- Do not show vanity metrics that are not actionable.
- Prefer existing table primitives; do not invent a new grid system.
- Keep row actions predictable across leads views.

---

## 10. Filters

### Principle

Filters refine work; they must be visible, reversible, and truthful.

### Why it matters

Invisible filters create “missing data” panic.

### Good examples

- Active filters shown as clear chips or selected controls.
- Zero results still show the filter UI + clear action.
- URL reflects filter state for back/forward and sharing.

### Bad examples

- Hidden filters that persist with no indicator.
- Clearing search but leaving stale results until manual refresh.
- Filter UI that disappears when results are empty.

### Never break

- Filtered-empty ≠ system-empty.
- Filter state belongs in the URL for primary CRM lists where users navigate deeply.
- Clearing filters must be one obvious action.

---

## 11. Search

### Principle

Search is a finder, not a maze. Results jump the user to work.

### Why it matters

Search exists to skip scrolling, not to create another product surface.

### Good examples

- Lead search selects a lead and focuses the workspace.
- Inbox search updates the conversation list with clear empty copy.
- Debounced input that does not stutter on every keypress.

### Bad examples

- Search that returns unexplained empty screens.
- Search that navigates away without a way back to the previous list.
- Instant full reload on each character with no debounce.

### Never break

- Preserve a path back to the unscoped list.
- Do not invent a second global search paradigm without reusing the existing one.
- Loading during search must not wipe the entire shell.

---

## 12. AI interactions

### Principle

AI assists the נציג; it never blocks the core lead workflow. AI states must be honest.

### Why it matters

Fake progress and silent AI failures teach users to ignore the assistant.

### Good examples

- Copilot open/close is explicit; ESC returns focus to work.
- In-flight generation shows a clear pending entry.
- Failure leaves a retryable error entry in the timeline.
- AI suggestions never auto-send WhatsApp without the user sending.

### Bad examples

- Rotating status text that pretends tokens are streaming when the server is still blocking.
- AI errors that vanish with no message.
- AI panels that trap focus or hide primary lead actions on desktop workflows.

### Never break

- No emoji in AI UI chrome.
- AI must not invent a separate “Client” entity concept.
- Do not auto-send customer messages from AI without explicit user action.
- Costly AI work should be intentional (user-triggered or clearly system-triggered), not surprise spam.

---

## 13. Streaming

### Principle

Stream when waiting is inherent (model generation). Do not fake streaming.

### Why it matters

Fake streaming destroys trust. Real streaming improves perceived speed for AI only.

### Good examples

- Copilot answer text appears as it is produced.
- User can abort a long generation when supported.
- Completed stream becomes ordinary timeline history.

### Bad examples

- Animated typing of a response that already finished on the server.
- Streaming unrelated CRM lists or tables.
- Partial stream that looks complete when it failed mid-way.

### Never break

- Do not simulate token streaming with timers.
- Do not stream where polling or RSC refresh is the correct model (invoice PDF, inbox deltas).
- Failed streams must surface as errors, not truncated success.

---

## 14. Polling

### Principle

Poll intelligently: faster when something may change, slower when idle or hidden, stop when terminal.

### Why it matters

Dumb fixed refresh wastes server work and causes UI flicker.

### Good examples

- Inbox adaptive polling with slower cadence on hidden tabs.
- Invoice PDF status polling that speeds early, slows later, stops on ready/failed.
- Lead incremental polling only while the tab is visible.

### Bad examples

- Full page refresh every few seconds regardless of changes.
- Multiple pollers fighting over the same badge/count.
- Polling forever after a job is finished.

### Never break

- One owner per live signal (e.g. inbox badge) — no duplicate authoritative pollers.
- Hidden tabs must back off.
- Terminal states must stop polling.
- Prefer delta/sync endpoints over full RSC refresh loops when a sync path exists.

---

## 15. Notifications

### Principle

Notifications pull the user to a concrete next action. They do not decorate.

### Why it matters

Notification fatigue trains users to ignore everything.

### Good examples

- New WhatsApp message toast that opens the right conversation.
- Single aggregated toast for many arrivals (“3 הודעות חדשות”).
- No toast spam while already on the inbox viewing live updates.

### Bad examples

- Toast for every background poll with no user action available.
- Notifications without a destination.
- Duplicate toasts for the same event from two systems.

### Never break

- If the user is already in the live surface, prefer silent badge/list updates over toast floods.
- Notification copy must be Hebrew and specific.
- Do not invent a second notification center UI unless Product requests it and reuses patterns.

---

## 16. Toasts

### Principle

Toasts confirm meaningful outcomes. They are not a general-purpose loading system.

### Why it matters

Overusing toasts makes the product feel noisy and cheap.

### Good examples

- “השינויים נשמרו”
- “יובאו 24 לידים בהצלחה”
- Error toast with what failed

### Bad examples

- Loading toast for every status click.
- Success toast for trivial toggles that already updated inline.
- Stacking many toasts that cover primary actions.

### Never break

- Prefer inline/optimistic feedback for high-frequency CRM actions.
- Keep success short; keep errors clearer than successes.
- Do not use toasts as the only error UI for form-field validation.
- No emoji in toasts.

---

## 17. Dialogs

### Principle

Dialogs interrupt. Use them for confirmation, focused create/edit, and blocking setup — not for routine reading.

### Why it matters

Modal overuse slows the 10–20 second action loop.

### Good examples

- Confirm before delete.
- Compact lead create/edit dialog.
- Setup required dialog that explains the missing connection and links to fix it.

### Bad examples

- Modal for content that should be a page section.
- Nested modals without a clear escape.
- Confirm dialogs with vague copy (“האם אתה בטוח?”) and no object named.

### Never break

- Destructive dialogs name the object and consequence.
- Always provide an obvious dismiss/cancel.
- Reuse existing modal/confirm patterns; do not invent a new dialog system.
- Escape/close must work consistently.

---

## 18. Motion and animation

### Principle

Motion clarifies cause and effect. It never entertains.

### Why it matters

Decorative motion reads as unprofessional in a CRM used for real revenue work.

### Good examples

- Brief highlight on a row that just updated.
- Smooth expand/collapse of an existing accordion pattern.
- Subtle content fade that does not delay interaction.

### Bad examples

- Long entrance animations on every table load.
- Playful bouncing icons.
- Motion that blocks clicks.

### Never break

- No emoji animations or sticker-like motion.
- Honor `prefers-reduced-motion`.
- Animation duration stays short; interaction never waits on animation completion.
- Do not add a new motion library for polish alone.

---

## 19. Accessibility

### Principle

The product must be operable by keyboard and understandable with assistive tech, without looking like an “a11y mode.”

### Why it matters

Accessibility bugs are product bugs. They also correlate with unclear UI for everyone.

### Good examples

- Buttons have clear accessible names (especially icon buttons).
- Toasts use live regions appropriately.
- Focus returns sensibly after closing dialogs/Copilot.

### Bad examples

- Icon-only controls with no name.
- Click-only interactions with no keyboard path.
- Color-only status with no text label.

### Never break

- Do not ship icon-only buttons without an accessible name.
- Do not remove focus outlines without an equivalent visible focus state.
- Do not rely on color alone for status.
- Do not regress the closed a11y suite intentionally.

---

## 20. Mobile responsiveness

### Principle

Core lead actions must work on small screens without requiring a desktop redesign fantasy.

### Why it matters

Reps follow up from phones. Broken mobile is lost revenue.

### Good examples

- Primary CTAs reachable with the thumb.
- Tables degrade to usable stacked/compact patterns already in the system.
- Filters remain usable without horizontal dead-ends.

### Bad examples

- Controls overflowing off-screen.
- Desktop-only critical actions with no mobile alternative when the page is otherwise available.
- Tiny tap targets.

### Never break

- Do not ship overflows on primary CRM routes.
- Do not invent a separate mobile app pattern inside the web app without reuse.
- Touch targets must remain comfortable.
- If a complex panel is desktop-only (e.g. Copilot), the core lead workflow must still work on mobile without it.

---

## 21. Performance perception

### Principle

Perceived speed is part of UX. Prefer instant local feedback and stable shells over raw benchmark theater.

### Why it matters

Users judge speed by how soon they can act, not by network waterfall screenshots.

### Good examples

- Optimistic row update while the Server Action completes.
- Skeleton content instead of a blank wait.
- Adaptive polling that avoids flicker from constant full refreshes.

### Bad examples

- Waiting on full RSC refresh to show a message the client already knows.
- Spinners for sub-second actions.
- Premature micro-optimizations that add architectural complexity without user benefit.

### Never break

- Do not add a client global cache framework to chase perceived speed.
- Do not trade correctness (wrong tab counts, stale-as-success) for a snappier lie.
- Prefer extending existing poll/sync/action patterns over new infrastructure.

---

## 22. Visual consistency

### Principle

One product language. Same spacing, controls, hierarchy, and Hebrew voice everywhere.

### Why it matters

Inconsistent screens feel like different products bolted together.

### Good examples

- Settings pages share card, checkbox, input, and button patterns.
- Status colors mean the same thing in tables and detail views.
- One primary solid button style for the main action.

### Bad examples

- One-off dark translucent cards on a single settings page.
- New button styles “just for this feature.”
- Mixing `לקוח` and `ליד` in adjacent UI.

### Never break

- Do not invent components, layouts, or visual styles when an existing pattern exists (`ux-guidelines.md` No UI Invention Rule).
- No emoji in product UI.
- Color carries meaning; it is not decoration.
- Terminology rules are mandatory.

---

## Pull Request checklist (merge gate)

Every UI-affecting PR must be able to answer **yes** to all applicable items:

### Clarity and action

- [ ] A new user understands the screen’s next step within 5 seconds
- [ ] There is one clear primary action (or a justified empty-state CTA)
- [ ] Hebrew terminology uses `לידים` / `נציג` (no `סוכן`, no invented Client entity)

### States

- [ ] Loading does not wipe the app shell for ordinary CRM fetches
- [ ] Skeletons (if used) match the destination layout
- [ ] Empty states explain what / why / what next
- [ ] Errors are visible, Hebrew, and recoverable
- [ ] Filtered-empty is not treated as system-empty

### Interaction quality

- [ ] High-frequency actions feel instant (optimistic or precise pending)
- [ ] Pending state is local to the control when possible
- [ ] Failures roll back optimistic UI or clearly explain the mismatch
- [ ] Toasts are not used as a generic loading system for row actions

### Data honesty

- [ ] Counts and tabs reflect true server-backed results when they claim to
- [ ] Polling has a single owner for each live signal; hidden tabs back off
- [ ] No fake streaming or fake progress presented as real work

### Consistency and a11y

- [ ] Reuses existing components/patterns; no one-off design system
- [ ] No emoji in UI
- [ ] Icon-only controls have accessible names
- [ ] Mobile primary actions remain reachable without overflow
- [ ] Motion is minimal, purposeful, and reduced-motion safe

### Architecture respect

- [ ] Solution works with RSC + Server Actions (no new global client data framework)
- [ ] Matches `architecture-rules.md` file/component boundaries for touched files

If any box cannot be checked, the PR is not ready to merge.
