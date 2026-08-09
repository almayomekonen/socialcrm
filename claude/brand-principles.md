# brand-principles.md — The SocialCRM Brand Principles

**Status:** binding for all product work, present and future. This document governs
every decision that shapes what the product feels like — product scope, interaction,
motion, language, AI behaviour, notifications, and error handling. It sits beside
`care-charter.md` and `product.md` in authority. Where a feature spec conflicts with
these principles, the principles win.

**Relationship to other documents.** `CLAUDE.md` §13 still wins over everything.
`product.md` defines who the user is and what they need; this document defines what
they should *feel*. `care-charter.md` governs AI surfaces specifically and is the more
detailed authority there — its laws are downstream of this foundation, not in tension
with it. `ux-guidelines.md` and `frontend-experience-guidelines.md` describe how screens
behave; this document explains why.

**This document should outlive the UI.** Screens, components, frameworks and features
will be replaced. The emotional foundation should not be.

---

## 0. THE FOUNDATION

> **The user can stop holding it in their head, because the system is holding it.**

One emotion, and the product owns it: **being held.**

Not control. Control is the CRM category's default, and it is the wrong emotion for this
user. Control implies more looking, more checking, more mastery of a tool — and looking
is precisely what these users are drowning in. Control asks the user to become better at
vigilance. Held releases them from it.

Not order, either. "Everything in one place" is about *where things are*. Held is about
*whether they are safe*. Consolidation is a mechanic; held is a feeling, and it is the
one we are selling.

**The single test for any decision in this product:**

> After this change, does the user have to hold less in their head?

If the honest answer is not yes, it does not ship — however good it is.

**Why this user, specifically.** They are the owner, the closer and the service desk in
one person (`product.md` §1). There is nobody to hand remembering to. Their current
system is built out of their own attention — memory, self-addressed WhatsApp messages,
a spreadsheet — and their leads arrive through channels that never close. The failure is
not lost data; it is the invisible leak that surfaces a week later as *"I never heard
back"* (`product.md` §10). The guilt that follows is self-attributed, and held is its
exact antidote: it moves the responsibility for remembering off the person and onto the
system.

**Held is proven by absence.** The strongest evidence that this product works is a
disaster that quietly never happened. That makes it hard to demo and slow to accrue —
and it is exactly why it is defensible. It cannot be bought, acquired, or shipped in a
quarter, and a single missed ליד or false alarm destroys it.

---

## 1. PRODUCT PRINCIPLES

### 1.1 Absorb the worry — do not display it

**Rule:** Every feature must name the specific worry it removes from the user. "Now you
can see X" is not absorption; it hands the watching back.

**Why:** A feature that improves visibility still requires the user to look. Held is
produced by not needing to look.

- **Good:** The system determines which לידים need attention today and says so.
- **Bad:** A new filter that lets the user find which לידים need attention.

### 1.2 Coverage before depth

**Rule:** Close the edges before deepening the middle. Reliability of capture outranks
sophistication of features.

**Why:** Held fails on the one ליד that slipped, never on the feature that was not built.
A single leak invalidates the promise no matter how good everything else is.

- **Good:** Making every lead source land reliably, including manual entry, before adding
  a new capability.
- **Bad:** Shipping a second AI summarisation mode while one source silently drops לידים.

### 1.3 State the boundary

**Rule:** What the system does *not* cover must be stated plainly, at the point where a
user would otherwise assume coverage.

**Why:** Held depends on the user's belief being accurate. An unstated gap is a promise
nobody made and the system will break.

- **Good:** Stating that Instagram DMs must be added manually because they cannot be read
  by external systems.
- **Bad:** Listing Instagram as a source with no note, letting the user assume automatic
  capture.

### 1.4 Never require setup before value

**Rule:** No configuration may stand between a new user and their first ליד.

**Why:** A system that must be configured before it holds anything has not yet held
anything. The promise must start working before the user has invested.

- **Good:** A ליד can be added within seconds of first login.
- **Bad:** Connecting an external channel is required before the לידים list is reachable.

---

## 2. UX PRINCIPLES

### 2.1 Reduce what must be remembered, not what must be clicked

**Rule:** Optimise for memory load first, interaction cost second.

**Why:** Clicks are cheap and visible; remembering is expensive and invisible. The
product's promise is about the second one.

- **Good:** The next action on a ליד is stated, so the נציג does not reconstruct it.
- **Bad:** A shortcut that saves one click but requires memorising a key combination.

### 2.2 One state at a time, and it must be the true one

**Rule:** Every screen renders exactly one state, and that state must be honest about
which situation the user is in.

**Why:** Ambiguity about what you are looking at is uncertainty — the root emotion this
product exists to remove.

- **Good:** A filtered-empty list says filters are active and offers to clear them.
- **Bad:** Filtered-empty rendered identically to "you have no לידים."

### 2.3 The system surfaces and catches; the user decides

**Rule:** The system may raise, order, and recover. It may not decide on the user's
behalf.

**Why:** Held must never become handled-without-consent. Care that removes agency is a
cage with good intentions.

- **Good:** Surfacing a ליד going cold and leaving the נציג to act.
- **Bad:** Automatically changing a ליד's סטטוס because the system inferred abandonment.

### 2.4 Never ask for what the system already knows

**Rule:** Anything the system can derive, it derives. The user is never asked to
re-enter or re-classify it.

**Why:** Every question is a transfer of load back to the person we promised to unload.

- **Good:** The מקור and arrival time travel with the ליד everywhere it appears.
- **Bad:** Asking the נציג to tag which channel a ליד came from.

---

## 3. MOTION PRINCIPLES

### 3.1 Motion shows that something was caught

**Rule:** Movement exists to narrate cause and effect — something arrived, something was
held, something changed. It never decorates.

**Why:** Held is a feeling about events. Motion is the only medium that can show an
event rather than its aftermath.

- **Good:** A new ליד visibly settling into the place it will now stay.
- **Bad:** Cards drifting continuously to create atmosphere.

### 3.2 Motion never delays action

**Rule:** The interface remains usable throughout any transition. Nothing waits on an
animation to finish.

**Why:** Held is calm, not slow. A product that makes you wait to feel premium has
traded the user's time for its own vanity.

- **Good:** The control is interactive while the transition completes.
- **Bad:** A 600ms entrance before a button becomes clickable.

### 3.3 If motion carries meaning, the meaning must survive without it

**Rule:** Any information conveyed by movement must be equally available when motion is
reduced or unavailable.

**Why:** A moment that exists only as animation does not exist for a meaningful share of
users, and held cannot be conditional on a device setting.

- **Good:** The same arrival reads as a clear state change with motion disabled.
- **Bad:** A "caught" moment that is only legible as an animation.

---

## 4. COMMUNICATION PRINCIPLES

### 4.1 Proportion governs volume

**Rule:** Loud only when something genuinely matters. Quiet — or silent — when it does
not.

**Why:** Because the product is proportional, every signal it sends can be believed.
This is the single most trust-building behaviour available to us.

- **Good:** One line when something needs attention; nothing at all when it does not.
- **Bad:** A daily summary that arrives whether or not anything changed.

### 4.2 Never report the user's neglect back to them

**Rule:** Frame recovery, never failure. The system never tallies what the user missed.

**Why:** Guilt is one of the four burdens we exist to lift. A product that counts your
failures has become the thing you were escaping.

- **Good:** "כדאי לחזור לדני מהשבוע שעבר"
- **Bad:** "הזנחת 12 לידים"

### 4.3 Say what happened, once, in the user's terms

**Rule:** Report the outcome the user cares about, not the operation the system
performed. Say it a single time.

**Why:** Repetition and system-language both signal that the product is thinking about
itself rather than the user.

- **Good:** "יובאו 24 לידים"
- **Bad:** "הפעולה הושלמה בהצלחה"

### 4.4 State uncertainty rather than guessing

**Rule:** When the system does not know, it says so.

**Why:** Honest uncertainty builds trust; confident wrongness destroys it permanently.
Held rests on the user's belief being accurate.

- **Good:** "אין מספיק מידע כדי לדעת"
- **Bad:** A confident figure the system actually inferred.

---

## 5. AI COPILOT PRINCIPLES

### 5.1 The AI never invents a business fact

**Rule:** Every count, name, date, סטטוס and amount comes from data. The model phrases,
orders and prioritises — it never produces the fact.

**Why:** One fabricated fact, discovered once, ends the relationship. Held is a claim
about accuracy before it is a claim about anything else.

- **Good:** The model orders a list the system computed.
- **Bad:** The model states how many לידים are waiting.

### 5.2 Triage, never dump

**Rule:** Surface the few things that matter most, ordered by what would hurt to miss.
Never present the whole pile.

**Why:** "47 things" is the feeling of being overwhelmed rendered as a list. "The three
that matter" is the feeling of being held.

- **Good:** The three לידים most at risk today.
- **Bad:** All 47 open לידים, sorted.

### 5.3 The AI is a surface, not a character

**Rule:** No persona, no name, no avatar, no performance of effort.

**Why:** Presence comes from being right, not from being seen. A character asks for
attention; held is produced by asking for less of it.

- **Good:** The answer appears, and the assistant recedes.
- **Bad:** A personality narrating that it is working on it.

### 5.4 The AI never acts outward without an explicit human send

**Rule:** No message reaches a ליד without the נציג deliberately sending it.

**Why:** The moment the system speaks to a customer on its own, the user must start
watching it — which is the opposite of the emotion we sell.

- **Good:** A drafted reply the נציג reviews and sends.
- **Bad:** An automatic reply dispatched on the user's behalf.

---

## 6. NOTIFICATION PRINCIPLES

### 6.1 A notification is a promise that something needed you

**Rule:** Interrupt only when the thing genuinely required attention now. The threshold
is high and honest.

**Why:** One unnecessary interruption discounts every future one, and that loss is
unrecoverable. Notification credibility is a non-renewable resource.

- **Good:** Raising a ליד that has waited past the point where waiting costs money.
- **Bad:** Notifying on every inbound message while the נציג is already reading the inbox.

### 6.2 Every notification has a destination and an action

**Rule:** If there is nothing to do about it, it is not a notification.

**Why:** A signal with no action is anxiety with no outlet — manufacturing exactly the
state we exist to remove.

- **Good:** Opening it lands on the specific conversation.
- **Bad:** A badge that increments with nowhere to go.

### 6.3 One owner per live signal

**Rule:** Each live count or indicator has exactly one authoritative source.

**Why:** Two systems counting the same thing will eventually disagree in front of the
user, and a product that contradicts itself cannot be trusted to hold anything.

- **Good:** A single authoritative unread count.
- **Bad:** A badge and a toast reporting different numbers for the same event.

### 6.4 Never notify for the system's benefit

**Rule:** No re-engagement prompts, no "we miss you", no streaks, no login guilt.

**Why:** Any mechanism whose purpose is to pull the user back for our benefit is the
precise opposite of care, and users recognise it immediately.

- **Good:** Weeks of silence because nothing needed them.
- **Bad:** A nudge because usage dipped.

---

## 7. ERROR HANDLING PRINCIPLES

### 7.1 A failure must never look like a success

**Rule:** Any operation that did not complete must be visibly incomplete, and stay that
way until resolved.

**Why:** This is the single most destructive event possible in this product. A user who
believes something was saved when it was not has been held by nothing, and will find out
at the worst moment.

- **Good:** A failed send remains visibly unsent, with a retry.
- **Bad:** An optimistic update left in place after the server rejected it.

### 7.2 Silence is never an acceptable failure mode

**Rule:** If a sync failed or data may be stale, say so. Never let a broken state look
identical to a working one.

**Why:** Held depends entirely on the user's belief matching reality. Silent failure
corrupts that belief invisibly.

- **Good:** Stating plainly that the channel is disconnected and לידים are not arriving.
- **Bad:** An empty list that looks the same whether nothing arrived or nothing worked.

### 7.3 Name what failed, in Hebrew, with a way forward

**Rule:** Every error says what did not happen and what to do next, in the user's
language.

**Why:** A vague error transfers the problem back to the user with no means to solve it.

- **Good:** "ההודעה לא נשלחה. נסה שוב."
- **Bad:** A raw provider code or English stack trace.

### 7.4 The system absorbs the error; it never blames the user

**Rule:** Error copy describes what the system could not do, never what the user did
wrong.

**Why:** Blame is the emotional opposite of being held, and it is almost never accurate.

- **Good:** "לא הצלחנו להתחבר לוואטסאפ."
- **Bad:** "לא הזנת את הפרטים הנכונים."

---

## 8. SUCCESS STATE PRINCIPLES

### 8.1 Confirm the outcome, not the operation

**Rule:** Success messages report the thing the user wanted, with the specifics that
prove it happened.

**Why:** Specificity is evidence. A generic confirmation asks the user to take our word
for it, which means they will check.

- **Good:** "יובאו 24 לידים"
- **Bad:** "הקובץ עלה"

### 8.2 Success returns the user to work

**Rule:** After an action succeeds, the user is looking at the result and able to
continue. Nothing blocks or celebrates.

**Why:** Held is a working calm, not a reward loop. Celebration interrupts the flow it
is congratulating.

- **Good:** After saving, the נציג is looking at the updated ליד.
- **Bad:** A celebratory dialog that must be dismissed before continuing.

### 8.3 Surface the save, never advertise the rescue

**Rule:** When the system recovers something the user would have missed, present the
recovered thing — never the fact that we recovered it.

**Why:** The unsolicited save is where the deepest trust is earned, and announcing it
converts care into performance. The cared-for user should not have to see most of what
we do for them.

- **Good:** The at-risk ליד is simply at the top of today's list.
- **Bad:** "הצלנו עבורך 3 לידים החודש"

---

## 9. EMPTY STATE PRINCIPLES

### 9.1 Empty is a guided next step, never a void

**Rule:** Every empty state answers three questions: what happened, why it matters, what
to do now.

**Why:** An unexplained void is the most uncertainty a screen can produce, and
uncertainty is the emotion we exist to remove.

- **Good:** An explanation plus a single clear primary action.
- **Bad:** A blank table with column headers.

### 9.2 Nothing-yet and nothing-matched are different states

**Rule:** An empty system and a filter that matched nothing must never look alike.

**Why:** Conflating them makes the user believe their data is gone — the exact panic the
product is supposed to prevent.

- **Good:** Filters stay visible, are named as active, and can be cleared in one action.
- **Bad:** Both rendered as the same empty screen.

### 9.3 An empty system must already feel held

**Rule:** Before any data exists, the empty state conveys readiness to catch — not
hunger to be fed.

**Why:** The promise begins at first login. A system that feels like it is waiting to be
filled puts the burden back on the user on day one.

- **Good:** "עוד לא נכנסו לידים. ברגע שייכנסו, הם יופיעו כאן." with a clear first action.
- **Bad:** An empty screen whose only message is that the user has not done their part.

### 9.4 Never fabricate data to look populated

**Rule:** No demo לידים, no sample rows, no placeholder activity presented as real.

**Why:** An honestly empty system that helps is worth more than a fake-full one, and a
single discovered fabrication destroys the accuracy the whole promise rests on.

- **Good:** A true empty state with a real first action.
- **Bad:** Seeded example לידים that must later be explained away.

---

## 10. COPYWRITING PRINCIPLES

### 10.1 The terminology is fixed

**Rule:** `ליד` / `לידים`, `נציג`, `סטטוס`, `מקור`. Never `לקוח`. Never `סוכן`. Never
`עסקה`. A closed ליד is still a ליד.

**Why:** One vocabulary across every surface is what makes the product feel like one
thing rather than several bolted together. Inconsistent naming is the first sign of a
system nobody is holding.

- **Good:** "הליד שויך ל־[שם נציג]"
- **Bad:** "הלקוח הועבר לסוכן"

### 10.2 Every button names its own outcome

**Rule:** A control's label states what will happen when it is used.

**Why:** A user who has to predict what a button does is holding something in their head
that we should have told them.

- **Good:** "שמור שינויים", "העלה לידים", "עדכן סטטוס"
- **Bad:** "אישור", "המשך", "בצע"

### 10.3 Write the sentence the user would say

**Rule:** Plain, concrete, short declaratives — the words the נציג would use to a
colleague, not the words a vendor would use in a brochure.

**Why:** Category language creates distance. Held is an intimate promise and needs
intimate language.

- **Good:** "שום פנייה לא נופלת"
- **Bad:** "פלטפורמה מתקדמת לניהול לידים"

### 10.4 Never use language that manufactures the anxiety we remove

**Rule:** No urgency theatre, no loss framing, no countdowns or pressure in any surface
whose job is care.

**Why:** Manufactured urgency converts reliably and destroys the one thing we are
actually selling. Commercial pressure belongs in its own room, never in a moment of
care.

- **Good:** "כדאי לחזור לדני מהשבוע שעבר"
- **Bad:** "אתה מפסיד לידים עכשיו"

### 10.5 No emoji

**Rule:** Not in UI, not in AI output, not in notifications, not in toasts.

**Why:** These are real businesses managing real revenue. Decoration reads as
unseriousness, and unserious is not a thing you hand your livelihood to.

---

## GOLDEN RULE

> **Before anything ships, ask one question: does the user now have to hold less in
> their head?**
>
> If the honest answer is not clearly yes — do not build it.

Everything above is a specific application of that sentence. When a situation is not
covered by any principle here, return to it and choose the behaviour that serves it.

---

## AMENDMENT

These principles are durable, not frozen. They may be changed — but only **explicitly,
in writing, with the reason stated**. A principle quietly set aside because a metric
dipped is a principle that was never real. If the business must override something here,
that override is itself a product decision and belongs in this document, with its cost
named.
