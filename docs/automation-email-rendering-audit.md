# Automation Email Rendering — UX & Rendering Audit

**Scope:** System B only — emails our customers send to THEIR leads through the
Automation Engine (`email.send`). Platform/lifecycle email (`lib/emailAutomations/`,
welcome / trial / billing / subscription) is **out of scope and untouched**.

**Audited against:** `origin/main` @ `b4b6d00c` (the automation engine as deployed).
The audit branch (`security/remediation-phase-1`) is 150 commits behind and does not
contain this code; all findings were verified in a clean worktree of `origin/main`.

**Status:** audit only. No code changed. Nothing implemented.

---

## 0. What the system actually is

The entire customer-facing email rendering system is **one 57-line file**:

- `lib/automations/renderEmail.tsx` — the whole shell: a `react-email` document,
  N paragraphs, an `<Hr>`, a footer line with the business name + unsubscribe link.
- `lib/automations/variables.ts` — closed-set token substitution
  (`{{שם הליד}}`, `{{שם העסק}}`, `{{שם הנציג}}`).
- `lib/automations/executors/email.ts` — resolves identity + vars, calls the renderer,
  hands `{subject, html, text}` to `lib/email/sender.ts` (Resend).
- `components/settings/automations/AutomationSheet.tsx` — the Builder, including a
  "כך זה ייראה" preview that does **not** use the renderer.

The customer authors **one plain-text blob**. `renderEmail` splits it on blank lines
into `<p>` elements and styles every one of them identically. There is no block model,
no design tokens, no signature concept, no logo, no brand color, no button, no
emphasis. Everything the emails feel like is decided by those 57 lines.

That is the root of every finding below: **there is no rendering system, only a
paragraph loop.**

---

## 1. Evidence base

Findings are backed by the real production output, not by reading alone.

**Exact HTML produced** for the shipped `in_progress_follow_up` template
(the "אנחנו על זה" screenshot), business name `Almayo Mekonen Mekonen`:

```html
<html dir="rtl" lang="he">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/>
  <meta name="x-apple-disable-message-reformatting"/>
</head>
<body style="background-color:#ffffff">
 <table border="0" width="100%" ... align="center"><tbody><tr>
  <td style="background-color:#ffffff;font-family:Arial, Helvetica, sans-serif">
   <table align="center" width="100%" ... style="max-width:560px;padding:24px">
    <tbody><tr style="width:100%"><td>
     <p style="font-size:15px;line-height:1.6;white-space:pre-line;text-align:right;
               margin-top:16px;margin-bottom:16px">שלום Almayo,</p>
     <p style="...">רצינו לעדכן שהפנייה שלך בטיפול פעיל אצל Almayo Mekonen Mekonen.</p>
     <p style="...">אם נוסף מידע שיכול לעזור לנו, או שיש שאלה — אפשר להשיב למייל הזה בכל שלב.</p>
     <p style="...">בברכה,
Almayo Mekonen Mekonen</p>
     <hr style="width:100%;border:none;border-top:1px solid #eaeaea;margin:24px 0"/>
     <p style="font-size:12px;line-height:24px;color:#6b7280;text-align:right;...">
       הודעה זו נשלחה מטעם Almayo Mekonen Mekonen.
       <a href="..." style="color:#6b7280;text-decoration-line:none;text-decoration:underline">הסרה מרשימת התפוצה</a>
     </p>
    </td></tr></tbody></table>
   </td></tr></tbody></table>
</body></html>
```

Note what is **absent**: any `dir` attribute below `<html>`, any `color` on body text,
any `<meta name="viewport">`, any `color-scheme` declaration, any `<title>`, any
preheader, any `<br>`, any font-family on the text elements themselves.

**Numeric bidi measurement.** The same HTML was rendered in Chromium under the two
base directions a recipient's client can impose, and the x-position of individual
glyphs was measured with `Range.getBoundingClientRect()` (this avoids the unreliability
of reading bidi text visually):

| measured glyph | base `dir=rtl` | base `dir=ltr` |
| --- | --- | --- |
| `א` — first letter of paragraph 3 | x = **668** (right edge) | x = **623** |
| `.` — sentence-final period of paragraph 3 | x = **193** (left edge) ✓ | x = **632** (to the *right* of the first letter) ✗ |
| `ש` — first letter of "שלום Almayo," | x = **666** (rightmost) ✓ | x = **567** (**leftmost**) ✗ |
| `A` — start of the lead's name | x = 602 | x = 592 |
| `,` — final comma | x = **588** (leftmost) ✓ | x = **632** (rightmost) ✗ |

Under an LTR base direction the greeting's **word order inverts** — the Hebrew word
lands to the *left* of the lead's name — and sentence-final punctuation lands at the
wrong end of every line. This is not a subtle kerning issue; the sentence reads
backwards.

---

## 2. Findings

Severity: **P0** = breaks or looks broken for real recipients · **P1** = visibly
unprofessional · **P2** = polish / robustness.

### 2.1 RTL / bidirectional text

| # | P | Finding |
| --- | --- | --- |
| RTL-1 | **P0** | **Base direction is declared only on `<html dir="rtl">`** — the one element mail clients discard. Gmail, Outlook.com and Yahoo extract the message body into their own DOM; the `<html>` and `<head>` wrapper does not survive. Nothing inside the body carries `dir`. The email's correctness therefore depends on **the recipient's mail-client UI language**, which the sender does not control: a lead on Hebrew Gmail sees correct Hebrew, a lead on English Gmail sees the measurements in the right-hand column above. Every Hebrew sentence in the email is affected. |
| RTL-2 | **P0** | **`text-align:right` is used as a substitute for direction.** Alignment is not direction: it moves the block to the right while leaving bidi resolution, line-break order, and neutral-character placement in LTR mode. This is why the email can look "almost right, but the dots are in the wrong place" instead of obviously broken. |
| RTL-3 | **P1** | **`text-align:right` is hardcoded**, so a customer who writes in English (or any LTR language) gets right-aligned LTR copy. The engine is multi-tenant; nothing constrains authored content to Hebrew. |
| RTL-4 | **P2** | **Interpolated values are not bidi-isolated.** A Latin business name at the end of a Hebrew sentence is a directional run inside an RTL paragraph. It renders acceptably for plain names but mis-orders for names containing trailing digits, parentheses, `&`, or a period (`"Almayo & Co."`, `"סטודיו 24"`). `<bdi>` / U+2068‑2069 isolation is absent. |
| RTL-5 | **P2** | `lang="he"` also lives only on `<html>`. Once stripped, screen readers in Gmail read Hebrew content with the reader's default language voice. |

### 2.2 Signature

| # | P | Finding |
| --- | --- | --- |
| SIG-1 | **P0** | **Single newlines are never converted to `<br>`.** The signoff `בברכה,\nAlmayo Mekonen Mekonen` is emitted as a raw newline inside one `<p>`, and line breaking relies **entirely** on `white-space:pre-line`. Clients that drop `white-space` (Outlook desktop's Word engine, Outlook.com) collapse the signature into a single run. The system already demonstrates the collapse itself: the **plain-text alternative it sends** renders `"בברכה, Almayo Mekonen Mekonen"` on one line. A customer whose signature is name / role / phone on three lines gets one line. |
| SIG-2 | **P0** | **Adjacent variable tokens render glued with no separator.** Verified: body `בברכה,\n{{שם העסק}}{{שם העסק}}{{שם העסק}}` renders `סטודיו אורסטודיו אורסטודיו אור`. This exactly reproduces the tripled, run-together business name in the production screenshot. Cause chain: `insertToken()` in `AutomationSheet.tsx:140` splices `{{token}}` at the caret with no separator and no guard against an adjacent token; validation (`actions/automations/manage.ts`) only checks that tokens are *known*; the renderer concatenates blindly; the Builder preview shows the same glued string in app typography, where it reads as a system glitch rather than as the user's own mis-click. **The system cannot currently be trusted to render a signature the customer typed.** |
| SIG-3 | **P1** | **There is no signature concept at all.** The signoff is the tail of a free-text blob, styled identically to body copy: same size, same weight, same color, same 16px gap. Premium transactional email gives the signature its own typographic treatment. Grep confirms zero signature/logo/brand-color surface anywhere in `lib/automations/`, `actions/automations/`, or the Builder. |
| SIG-4 | **P2** | A body written with single newlines throughout (no blank lines) collapses to **one** `<p>` — verified. Paragraph rhythm then depends on `white-space` too, not on structure. |

### 2.3 Typography

| # | P | Finding |
| --- | --- | --- |
| TYP-1 | **P1** | **No text color is declared anywhere on body copy.** Background is explicitly `#ffffff`; text color is left to the client. Combined with no `color-scheme` / `supported-color-schemes` declaration, dark-mode clients (Gmail, Apple Mail) are free to darken the declared background while leaving or inverting undeclared text — the classic low-contrast / invisible-text failure. Explicit background + implicit foreground is the single most reliable way to get a broken dark mode. |
| TYP-2 | **P1** | `font-family` is set **only** on the outer wrapper `<td>` and inherited. Outlook (Word engine) and Outlook.com routinely re-apply their own font to `<p>`/`<td>`; text elements need it declared on them. |
| TYP-3 | **P1** | `Arial, Helvetica, sans-serif` for Hebrew. Arial's Hebrew is functional but flat, and there is no Hebrew-aware stack (no Assistant/Rubik/Heebo web-safe fallback chain, no `Segoe UI`/`-apple-system` first choice). Typography reads as a 2005 default, which is a large part of the "doesn't feel premium" complaint. |
| TYP-4 | **P1** | `font-size:15px` body copy. Below the 16px comfort floor for Hebrew, and below it specifically on mobile where most leads read. |
| TYP-5 | **P1** | **Line-height is inconsistent between blocks:** body `line-height:1.6` (unitless), footer `line-height:24px` on `font-size:12px` (ratio 2.0). Two different vertical rhythms in one email. Unitless line-height is also unreliable in Outlook. |
| TYP-6 | **P1** | **Only one type size and one weight exist** (15px regular + a 12px footer). No hierarchy: greeting, body, closing, and signature are typographically identical. Nothing tells the eye where to start. This is the "weak hierarchy" complaint, precisely. |
| TYP-7 | **P2** | Footer is 12px `#6b7280` — contrast measures **4.83:1** on white, which passes WCAG AA for normal text, but 12px Hebrew is small. Size, not contrast, is the issue. |
| TYP-8 | **P2** | The unsubscribe link carries contradictory declarations: `text-decoration-line:none;text-decoration:underline` (a `react-email` artifact). The shorthand wins today, but a sanitizer that drops shorthands leaves an un-underlined link in the same color as its surrounding text — invisible as a link. |

### 2.4 Spacing & layout

| # | P | Finding |
| --- | --- | --- |
| SPC-1 | **P1** | **Every paragraph carries both `margin-top:16px` and `margin-bottom:16px`.** Browsers collapse adjacent margins to 16px; **email clients that do not collapse (Outlook) produce 32px.** The same email has different vertical rhythm in different inboxes — the literal "spacing is inconsistent" symptom. Email spacing must be one-directional or driven by spacer rows. |
| SPC-2 | **P1** | `padding:24px` is set on the **`<table>` element**. The Word engine ignores padding on `<table>`, so in Outlook desktop the copy runs to the edge of the message with no gutter. Padding belongs on the `<td>`. |
| SPC-3 | **P1** | The `24px 0` rule + `16px` paragraph margins mean the footer sits ~40–56px below the signature depending on client, with no deliberate relationship between them. There is no spacing scale — three unrelated magic numbers (16 / 24 / 12). |
| SPC-4 | **P2** | `<hr>` is rendered as a real `<hr>` with `border-top`. Outlook renders `<hr>` with its own inset and color. A 1px-height table row is the portable divider. |
| SPC-5 | **P2** | No vertical padding above the first paragraph or below the footer — the message begins and ends flush against the client's chrome. |

### 2.5 Responsiveness

| # | P | Finding |
| --- | --- | --- |
| RSP-1 | **P1** | **No `<meta name="viewport">`.** Combined with `x-apple-disable-message-reformatting`, some Android/third-party clients render at desktop metrics and zoom out, shrinking 15px text further. |
| RSP-2 | **P1** | **`max-width:560px` is the only width control.** The Word engine ignores `max-width`, so in Outlook desktop the inner table expands to the full reading pane — 900–1100px line lengths of 15px Hebrew, with no gutter (SPC-2). No MSO ghost table, no fixed-width fallback. |
| RSP-3 | **P1** | **No `word-break` / `overflow-wrap`.** Verified: a long URL in the body (`https://example.co.il/very/long/path/...?utm_source=...`) is emitted as one unbreakable token, forcing horizontal overflow or a shrunken layout on mobile. Customers paste URLs constantly. |
| RSP-4 | **P2** | No mobile type scale. The same 15px/1.6 is used at 375px and 1440px. |

### 2.6 Gmail compatibility (the dominant client here)

| # | P | Finding |
| --- | --- | --- |
| GML-1 | **P0** | The document wrapper — and with it `dir="rtl"` and `lang="he"` — does not survive Gmail's body extraction. See RTL‑1. This is the highest-impact Gmail issue and it is invisible to the sender whose own Gmail UI is Hebrew, which is why it has survived in production. |
| GML-2 | **P1** | **No preheader.** Gmail's inbox snippet is therefore the greeting — "שלום Almayo, רצינו לעדכן..." — wasting the second-most-read line in the entire email. |
| GML-3 | **P1** | **No `List-Unsubscribe` / `List-Unsubscribe-Post` headers.** Verified absent from `lib/email/sender.ts` and the whole send path; the unsubscribe exists only as a body link. Gmail's native one-click unsubscribe never appears, and bulk-sender expectations are unmet — a deliverability and trust cost, not just a UX one. |
| GML-4 | **P1** | No `color-scheme` / `supported-color-schemes` meta, and no explicit text color (TYP‑1) — Gmail dark mode is left to guess. |
| GML-5 | **P2** | `<!-- -->` comment separators appear inside the footer text (React interpolation artifact), and `<!--$-->`/`<!--/$-->` React markers wrap the body. Harmless in practice, but they are noise in a document that other clients' sanitizers rewrite. |
| GML-6 | **P2** | No `<title>`. Some clients use it for the tab/preview label. |

### 2.7 UX & product

| # | P | Finding |
| --- | --- | --- |
| UX-1 | **P0** | **The Builder preview is not the email.** `AutomationSheet.tsx:301‑315` renders the body as `<p className='text-sm text-gray-600 whitespace-pre-line'>` — app font, app size, app color, one paragraph, no footer, no unsubscribe, no subject/From relationship, and `businessName: null` / `repName: null` so both resolve to the placeholder `"העסק"` rather than the real business name. `variables.ts` states the goal — *"the server renderer and the client-side preview share ONE implementation. A preview that substituted differently from the real send would be a lie"* — but only **substitution** is shared. **Rendering is not.** The customer cannot see what they are sending, which is why SIG‑2 shipped. |
| UX-2 | **P1** | **The subject duplicates the From display name.** Every shipped template ends its subject with `— {{שם העסק}}`, while the From header is already `"Almayo Mekonen Mekonen" <…>`. In the Gmail list the business name appears twice in one row, consuming subject characters that could carry meaning. Visible in both production screenshots. |
| UX-3 | **P1** | **No primary action.** The emails say "אפשר להשיב למייל הזה" in body-weight text. There is no button, no linked affordance, nothing the eye lands on. For a CRM whose product law is "every screen leads to an action," the customer-facing email is the one surface with no action at all. |
| UX-4 | **P1** | **No brand presence.** No logo, no brand color, no header — nothing identifies the sender visually. `agencies.img` already exists as a logo FK (used for invoice PDFs) and is never read by this path. The email's only identity is a name in plain 15px Arial. |
| UX-5 | **P2** | **Authored content has no formatting capability at all.** Verified: user-typed markup is HTML-escaped (correct and safe) — but that also means no bold, no list, no link text. A customer who wants to emphasize one line cannot, so they resort to CAPS or repetition. |
| UX-6 | **P2** | `renderEmail` has no guard for an empty paragraph set — an empty body would produce a footer-only email. Currently prevented upstream (`body_required` in `manage.ts:60`), so this is defense-in-depth only. |
| UX-7 | **P2** | The plain-text alternative is degraded: signature newlines collapse to spaces (SIG‑1), the divider becomes a row of 40 hyphens, and the unsubscribe URL is inlined mid-sentence. |

### 2.8 Test coverage

| # | P | Finding |
| --- | --- | --- |
| TST-1 | **P1** | `__tests__/automations/renderEmail.test.ts:32` asserts `expect(rendered.html).toContain('dir="rtl"')`. That assertion is satisfied by the `<html>` tag alone — **the test passes precisely because of the string that clients discard.** No test renders the sanitized body, asserts a surviving `dir`, checks bidi ordering, or exercises a signature. The suite is green on the P0 defect. |

---

## 3. Root causes

Fixing the 30 findings individually would be whack-a-mole. They reduce to five:

1. **No rendering system.** A paragraph loop with inline magic numbers, not a shell +
   block model + token set. Nothing can be "made premium" because there is nothing to
   make premium in.
2. **Direction asserted where clients discard it.** Correctness is delegated to the
   recipient's client configuration.
3. **The body is an opaque blob.** Structure the design needs (greeting, paragraph,
   closing, signature, action, line break) is never represented, so it cannot be styled.
4. **Preview ≠ send.** No feedback loop, so authored-content defects reach real inboxes
   before anyone sees them.
5. **Tests assert strings, not survivable output.** The safety net has a hole exactly
   where production broke.

---

## 4. Phased implementation plan

Ordering principle: **the correctness gate first, then the shell, then the content
model, then the feedback loop, then deliverability.** Each phase ships independently
and leaves the system better than it found it. Nothing touches the Engine, the Builder's
logic, the Catalog, the Connectors, Templates, or platform email.

**Non-negotiable constraint for every phase:** `renderAutomationEmail`'s input shape
(`{subject, body, vars, unsubscribeUrl}`) and output shape (`{subject, html, text}`) are
consumed by `executors/email.ts` and are **additive-only** — no renames, no removals
(`do-not-touch.md` §3). New files stay under the 250-line soft limit
(`architecture-rules.md` §1); `renderEmail.tsx` gets split into a shell + blocks +
tokens rather than growing.

---

### Phase 0 — The correctness harness (no visual change)

**Why first:** every later phase is a claim about how an email renders in a client we
cannot run in CI. Without this gate, Phase 1 is a redesign on faith, and TST‑1 means
the current suite will stay green through a regression.

- A test helper that **simulates client sanitization**: strip `<html>`/`<head>`/`<body>`,
  re-host the surviving markup inside a container of a chosen base direction.
- **Numeric bidi assertions** using `Range.getBoundingClientRect()` (the method used for
  this audit's evidence table) — sentence-final punctuation must be at the left edge, the
  first Hebrew letter at the right edge, **under both `dir=rtl` and `dir=ltr` hosts**.
- Structural invariants: every text element declares `dir`, `color`, `font-family`,
  `font-size`, `line-height`; no unitless line-height; no both-direction margins;
  no padding on `<table>`.
- Golden-file snapshots of the HTML + plain-text output for a fixture set: Hebrew,
  English, mixed, long URL, multi-line signature, adjacent tokens, one-paragraph body.
- Replace TST‑1's assertion with one that fails on today's output.

**Exit:** the harness fails on `main` for RTL‑1, SIG‑1, SPC‑1, TYP‑1. Red is the
correct starting state.

---

### Phase 1 — The email shell (P0/P1 rendering, no content-model change)

The premium-regardless-of-content layer. Same paragraph loop, correct chrome.

- **Direction on every surviving element** — `dir` on the wrapper `<td>` and on each
  text block; `text-align` derived from direction, never used as a stand-in (RTL‑1/2).
- **Design tokens** in one module: type scale, spacing scale, color, radius, width.
  Kills the 15/16/24/12 magic numbers (TYP‑5/6, SPC‑3).
- **Typography:** Hebrew-aware font stack declared on every text element; 16px body;
  consistent line-height in units; explicit `color` on all text (TYP‑1/2/3/4).
- **Dark mode:** `color-scheme` + `supported-color-schemes`, explicit foreground and
  background on every block (TYP‑1, GML‑4).
- **Spacing:** one-directional margins or spacer rows; padding moved to `<td>`;
  divider as a 1px table row (SPC‑1/2/4/5).
- **Width & mobile:** `<meta viewport>`, `overflow-wrap`/`word-break` on text blocks,
  mobile type step (RSP‑1/3/4). Per the client-bar decision (§5.3), Outlook desktop gets
  the cheap wins only — padding on `<td>` (SPC‑2), real `<br>` (SIG‑1), one-directional
  margins (SPC‑1), table-row divider (SPC‑4) — and **no MSO ghost tables**. RSP‑2 is
  therefore accepted as a known Outlook-desktop limitation, documented, not fixed.
- **Branding seams reserved:** the shell gains an (initially unused) header slot above
  the first block and a signature slot below the last, so Phase 5 wires content into an
  existing structure instead of re-cutting the shell.
- **Hierarchy:** greeting, body, closing, and footer become distinct typographic roles
  (TYP‑6) — the same words, given a reading order.
- Housekeeping: `<title>`, `lang` on a surviving element (RTL‑5, GML‑6).

**Exit:** Phase 0 green for every invariant and both base directions. Byte-identical
*content*, transformed rendering.

---

### Phase 2 — The content model (signature, structure, safety)

Make authored content renderable well no matter how it was typed.

- **A block model** between blob and HTML: parse the body into typed blocks
  (paragraph, line-break group, closing, signature, URL). The renderer stops guessing.
- **`\n` → `<br>`** as real markup; `white-space:pre-line` demoted to a backstop
  (SIG‑1, SIG‑4).
- **Signature as a first-class block** with its own typographic treatment (SIG‑3).
- **Adjacent-token repair** — a separator is guaranteed between substituted values, at
  the substitution layer so preview and send agree; plus a Builder guard in
  `insertToken()` so the mis-click cannot be authored (SIG‑2).
- **Bidi isolation** of every interpolated value (RTL‑4).
- **`dir=auto` per block** so English-writing customers get LTR copy (RTL‑3).
- **Plain-text alternative rebuilt** from the same blocks — signature preserved, link
  placed on its own line (UX‑7).
- Renderer-level empty-body guard (UX‑6).
- **One optional primary-action block** (§5.2). **The product model is an optional CTA
  block, not two extra text fields.** The Builder presents it as a single optional
  action-block affordance the customer adds or omits as a unit — add it and both CTA
  label and CTA URL appear together as one titled group; omit it and neither exists.
  It is never two loose inputs appended below the body. Rendered as a bulletproof
  table-cell button (not an `<a>` with padding, which Outlook drops), with the link also
  present in the plain-text alternative. Mechanics below serve that model and are chosen
  to avoid Builder or schema redesign — storage is an implementation detail, the block is
  the product:
  - Two `text` parameters added to `email.send` in `catalog/entries/actions.ts`
    (`ctaLabel`, `maxLength` ~40; `ctaUrl`, validated by `validation.pattern` — the
    catalog's existing serialized-regex mechanism, since `PARAMETER_TYPES` has no `url`
    type and adding one is new vocabulary we don't need).
  - Stored inside the existing `parameters` **jsonb** object, where `subject` and `body`
    already live — **no migration, no schema change** (`do-not-touch.md` §2).
  - Surfaced in the Builder as **one optional block** — an "add a button" affordance that
    reveals a single titled group containing CTA label + CTA URL, and removes both
    together. It reuses the existing field primitives and the `subject`/`body` wiring
    precedent, so no new Builder architecture. Note: `RemoteParameters.tsx` renders
    *event* parameters and handles only `enum_remote`/`enum_static`, so it cannot pick
    these up — and teaching it `text` action parameters would be the Builder redesign
    we're avoiding.
  - Validated in `manage.ts` and `sendTest.ts` alongside the existing token checks; a CTA
    with a label and no URL (or vice versa) is rejected, and both are token-substitutable.
  - Absent CTA renders nothing at all — no empty button, no reserved space.

**Exit:** the multi-line-signature, adjacent-token, LTR, long-URL, and with/without-CTA
fixtures all render correctly under both base directions.

---

### Phase 3 — Preview fidelity (close the loop)

- **One renderer for preview and send.** The Builder's "כך זה ייראה" shows the *real*
  rendered email — server-rendered HTML in a sandboxed `iframe`, at the real width,
  with the real footer and unsubscribe row (UX‑1).
- Preview substitutes the **real** business name and rep name, not `"העסק"` (UX‑1).
- The subject preview shows the From display name beside it, making UX‑2's duplication
  visible to the person authoring it.

**Exit:** a screenshot diff between the Builder preview and a test-send is
indistinguishable. This is the phase that stops the next SIG‑2 from shipping.

---

### Phase 4 — Deliverability & inbox presence

- **`List-Unsubscribe` + `List-Unsubscribe-Post` headers** on automation sends
  (additive change in the automation send path; **platform email untouched**) (GML‑3).
- **Preheader block** — derived, not authored, so nobody has to write one (GML‑2).
- **Subject/From de-duplication** — drop `— {{שם העסק}}` from the shipped templates and
  surface the redundancy in the Builder. Existing customer-authored subjects are left
  alone; template content only (UX‑2).

**Exit:** Gmail shows a native unsubscribe control and a purposeful snippet.

---

### Phase 5 — Brand presence *(in scope — §5.1)*

Fills the seams reserved in Phase 1. This is what makes two customers' emails look like
two different businesses rather than one template.

- **Logo block** reading the existing `agencies.img` (already the invoice-PDF logo
  source), with a name-only fallback when unset, a hard max render height, `alt` text,
  and correct behaviour with images blocked — the default state in many clients (UX‑4).
- **One brand accent color**, applied to defined roles only (CTA fill, divider, link) —
  never as decoration (`ux-guidelines.md` §9). Needs a contrast guard so a customer's
  pale brand color cannot produce unreadable button text.
- **A structured signature** (name / role / phone) replacing typed free text, which
  retires SIG‑1/2/3 at the source rather than repairing them downstream (SIG‑3).
- **Configuration surface is not redesigned.** Where a value doesn't exist yet, the
  decision on where it's set is a separate, explicitly-scoped step — this phase reads
  and renders, it does not invent a branding settings page.

**Exit:** two customers with different brands produce recognizably different, equally
premium emails from identical copy.

---

## 5. Decisions taken

1. **Brand presence is in scope.** Phase 5 is a committed phase, not an option; Phases 1–2
   reserve the header/signature seams so it wires into existing structure. "Do not
   redesign customer branding" is read as *don't rebuild how branding is configured* —
   this work reads existing values (`agencies.img`) and renders them.
2. **One primary-action button block, and nothing more.** Phase 2 adds an optional
   CTA (label + URL) using existing catalog and storage mechanisms. Inline emphasis and
   lists stay **out** — the content model remains closed and HTML-escaped, so the shell
   carries the premium feel rather than the customer's formatting skill. UX‑5 is
   accepted, not fixed.
3. **Gmail (web + iOS/Android) and Apple Mail are first-class; Outlook desktop is
   best-effort.** Outlook gets the cheap, portable wins in Phase 1; MSO ghost tables are
   out, so RSP‑2 (full-width layout in Outlook desktop) is an accepted, documented
   limitation. Revisit only if B2B/corporate lead traffic proves material.

---

## Appendix — reproduction

```bash
git worktree add --detach <tmp> origin/main
ln -s <repo>/node_modules <tmp>/node_modules
# render the shipped template through the production renderer
tsx _render_audit.tsx        # writes _out.html / _out.txt
# measure bidi glyph positions under both base directions
node _bidi.mjs
```

Scripts used for this audit live in the session scratchpad
(`_render_audit.tsx`, `_bidi.mjs`, `_edge.tsx`, `_shot.mjs`) and are not part of the
repository. Phase 0 turns them into permanent tests.
