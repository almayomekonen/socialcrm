# security-decisions.md — Browser Security Posture (Decision Record)

**Status:** binding. Sits beside `do-not-touch.md` and `architecture-rules.md`.

**Purpose:** record which browser-security controls are ON, which are OFF **on
purpose**, and what breaks if someone turns them on. Three of the items below
are reported as failures by automated scanners. They are not oversights, and a
scanner score is not a reason to change them.

**Amendment rule:** these decisions may be revisited — but only by re-running the
evidence, not by citing a scanner. Each entry names the exact thing that would
have to change first.

---

## 1. ENABLED

| Control | Value |
| --- | --- |
| `Content-Security-Policy` | enforced (see `next.config.mjs`) |
| `Content-Security-Policy-Report-Only` | tighter candidate policy, reported to `/api/security/csp-report` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (`no-referrer` on `/api/magic`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |

The enforced CSP is strict where strictness cannot break a fetch
(`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'`) and deliberately permissive on `connect-src` until the
report endpoint has data from authenticated surfaces.

Both policies report, which closes the original defect: the app shipped
report-only for a long time with **no** `report-uri`, so nothing was ever
collecting the evidence its own comment promised to wait for.

---

## 2. INTENTIONALLY DEFERRED

### 2.1 Cross-Origin Isolation (COOP `same-origin` + COEP `require-corp`)

**Deferred. It breaks authentication.**

- `COOP: same-origin` severs `window.opener` for cross-origin popups. Google
  Sign-In runs `display=popup` and returns the credential through the opener
  (verified live on `/auth`), and WhatsApp Embedded Signup depends on a
  `postMessage` from the Facebook popup (`lib/facebook/useEmbeddedSignup.ts`).
- `COEP: require-corp` blocks every cross-origin subresource without a CORP
  opt-in — the Facebook SDK, the Google Picker, Cloudinary icons.

Isolation exists to unlock `SharedArrayBuffer` and high-resolution timers. This
app uses **neither** (no WebAssembly, no SharedArrayBuffer anywhere in the tree).
So the trade is "break login and WhatsApp onboarding to unlock capabilities we do
not use" — an outage with a better score.

`same-origin-allow-popups` is set instead: the part of the benefit that costs
nothing. It does **not** satisfy a scanner looking for full isolation, and that
is the correct answer rather than the flattering one.

**Revisit when:** Google Sign-In and Meta Embedded Signup both move off
popup/`window.opener` flows.

### 2.2 Trusted Types (`require-trusted-types-for 'script'`)

**Deferred for framework compatibility, not application code.**

Application code is already clean: zero `innerHTML` / `outerHTML` /
`insertAdjacentHTML` / `document.write`, zero `eval` / `new Function`, and two
`dangerouslySetInnerHTML` (a static CSS constant and a `JSON.stringify` of server
data).

The blocker is `script.src = <string>`, which Trusted Types turns into a throw.
There are three in app code — the Google Picker loader
(`lib/integrations/google/picker/loadPickerScripts.ts`), the Facebook SDK loader
(`lib/facebook/useEmbeddedSignup.ts`), and the Meta Pixel — **plus Next.js /
Turbopack's own chunk loader**, which registers no policy. That last one is the
real blocker: enabling Trusted Types breaks client-side navigation, not just a
feature.

**Revisit when:** Next.js ships a Trusted Types policy for its chunk loader.

### 2.3 CSP nonces (removing `'unsafe-inline'` from `script-src`)

**Deferred because it would delete static and PPR rendering.**

Next 16 reads the nonce from the **request** CSP header
(`app-render.js` → `getScriptNonceFromHeader`), so it must come from middleware
and must be known when the document shell renders. A statically prerendered page
has no request, so its framework bootstrap scripts ship unnonced — and serving
that HTML under a per-request nonce blocks the page's own bootstrap.

Measured cost: **6 static + 30 PPR routes** become fully dynamic. The PPR set is
the product — `/dashboard`, `/inbox`, `/leads`, `/m`, `/notifications`,
`/clients`, `/settings/*`. **Every mobile tab destination is PPR.** Hashes are not
an escape hatch: the RSC flight payload differs on every render.

Measured benefit today: low. There is no known injection vector (see 2.2), and
React escapes by default.

Note for whoever tries: a nonce **disables** `'unsafe-inline'` in browsers that
support it, so the two cannot be shipped together as a safety net.

**Revisit when:** a genuine HTML-injection sink appears, Next ships
prerender-compatible nonce support, or a compliance requirement names
`'unsafe-inline'`.

---

## 3. COMPLETED HARDENING

**Application-owned executable inline scripts are ZERO.**

The Meta Pixel was the last one. Its snippet moved from an inline
`<Script>{…}</Script>` into bundled module code (`lib/facebook/fbqBootstrap.ts` +
`PixelBootstrap` in `lib/facebook/MetaPixel.tsx`); `fbevents.js` now loads as an
external `<Script src>` under the same `afterInteractive` strategy.

Verified in a browser rather than assumed — production before vs. local build
after: the `<script id="meta-pixel">` element is gone, while `window.fbq`, the
SDK version (2.9.380), the registered pixel id and the PageView beacon are all
identical.

Remaining inline scripts are framework-generated (Next `__next_f` flight payload,
React 19 Suspense runtime) plus our JSON-LD — and JSON-LD is a **data block that
never executes**, confirmed to survive a strict nonce policy in the DOM, so
structured data is unaffected.

This does not remove the need for `'unsafe-inline'` (the framework still needs
it). It removes the application's side of the blocker, so a future nonce
migration has no app-side work left.

---

## 4. GUARDRAIL

`__tests__/a11y/securityHeaders.test.ts` and
`__tests__/a11y/metaPixelNoInlineScript.test.ts` pin all of the above, including
the two refusals in §2.1 and §2.2. They exist so nobody "fixes" a scanner finding
into an outage. If a change here is genuinely wanted, change the decision in this
file first, then the tests.
