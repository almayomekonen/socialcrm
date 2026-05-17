# Billing — Aggressive QA Checklist

Manual runtime tests. Execute against `npm run dev` (http://localhost:3000) signed in as the **owner** (admin) account. Each test has a severity tag — fix CRITICAL/HIGH before launch.

For every failure capture: **steps that worked → step that broke → what you saw**. The "Possible failure indicators" column tells you what to watch for, not what's guaranteed.

Set up before starting:
- Pick a working test lead and note its ID (e.g. `14746`).
- Pick a lead that has at least 4 prior invoices (for the "כבר חויבו" group).
- Open the dev-server terminal in a visible window so you can spot server errors.

---

## A1. Invoice Creation — Happy Path Sanity

**Steps:**
1. Navigate to `/clients/<leadId>/billing/new`.
2. Confirm "לכבוד" card shows the lead's name in the trigger button.
3. Add a single line: title "test", quantity 1, unit price 200.
4. Click "שמור טיוטה".

**Expected:** Toast "הטיוטה נשמרה". URL becomes `/clients/<leadId>/billing/<invoiceId>`. Draft editor shows your line + total ₪236.

**Possible failure indicators:** stuck on `/new`; double toast; "failed" error; wrong total; line missing.

**Severity:** CRITICAL — if this breaks, everything else is moot.

---

## A2. Customer Picker Smoke

**Steps:**
1. On `/clients/X/billing/new`, click the customer picker trigger.
2. Observe initial dropdown.
3. Type 2+ chars of a real lead name.
4. Pick a different lead.

**Expected:** Initial dropdown shows recents (split into "כבר חויבו" / "לידים אחרונים" when both exist). Typing 2+ chars triggers live search (~200ms debounce). Selecting navigates to `/clients/<newId>/billing/new` and the lead name in the recipient strip changes.

**Possible failure indicators:** empty dropdown; group headers transparent (scroll-bleed); dropdown clipped by card; live search returns wrong results; navigation doesn't happen.

**Severity:** HIGH — this is the discovery surface.

---

## A3. Customer Picker — Click Outside / Escape

**Steps:**
1. Open picker.
2. Click anywhere outside the dropdown panel (not on the trigger).
3. Reopen picker, press `Escape`.

**Expected:** Click-outside closes the panel. Escape does nothing currently (no handler) — note if it's missing.

**Possible failure indicators:** dropdown doesn't close on outside click; outside click + reopen leaves stale search query; escape navigates away unintentionally.

**Severity:** MEDIUM.

---

## A4. Create New Lead From Inside Picker

**Steps:**
1. Open customer picker on `/billing/new`.
2. Click "+ יצירת לקוח/ה חדש/ה" at the bottom of the dropdown.
3. Fill the ClientFormPop modal with a clearly new name (e.g. "QA TEST LEAD <timestamp>").
4. Save.

**Expected:** Modal closes. Page navigates to the new lead's `/billing/new`. Recipient strip shows the new lead. The trigger button shows the new name.

**Possible failure indicators:** stuck modal; toast says success but no navigation; navigates to wrong lead; new lead doesn't appear on next dropdown open.

**Severity:** HIGH.

---

## A5. Lines — Rapid Add via Enter Key Spam

**Steps:**
1. On `/billing/new`, focus title field in "+ פריט חדש" row.
2. Type "row1", Tab, type "1", Tab, type "100", Enter.
3. Without pausing, type "row2", Tab, "1", Tab, "200", Enter.
4. Repeat 10× fast.

**Expected:** Each row commits and the title input refocuses for the next. No duplicate rows. Totals tally correctly.

**Possible failure indicators:** duplicate rows; some rows missing; total wrong; focus lost; "+ פריט חדש" stuck busy.

**Severity:** HIGH — this is the spreadsheet flow real users will hammer.

---

## A6. Lines — Focus Jumping Mid-Row Should NOT Auto-Commit

**Steps:**
1. Type "test" in title.
2. Click into the quantity field (without typing a price).
3. Click into the price field.
4. Click outside the row.

**Expected:** No row is committed (price was never typed). After step 4 with title+default qty=1 but no price, the row should NOT create. The new-line draft stays open with the typed title.

**Possible failure indicators:** phantom row appears with price 0; row created prematurely; title cleared.

**Severity:** HIGH — we explicitly fixed this earlier; verify it stays fixed.

---

## A7. Lines — Negative Discount Block

**Steps:**
1. Add a normal line, save draft.
2. On the draft editor, click the discount cell of the line.
3. Type `-50` and blur.

**Expected:** The value reverts; no update is committed; total stays unchanged. Server-side validation should reject this (we added it).

**Possible failure indicators:** line accepts -50; total inflates; toast says success.

**Severity:** CRITICAL — H2 fix verification.

---

## A8. Lines — Zero/Negative Quantity Block

**Steps:**
1. On a draft line, set quantity to `0` and blur.
2. Then try `-1`.

**Expected:** Both revert. No update commits.

**Possible failure indicators:** quantity 0 is accepted; line total goes to 0 or negative.

**Severity:** CRITICAL.

---

## A9. Rapid Click on "שמור טיוטה"

**Steps:**
1. On `/billing/new` with at least one line, click "שמור טיוטה" 5× as fast as you can.

**Expected:** Only ONE draft is created. Page navigates once. Server log shows one `saveTransientDraftAction` call.

**Possible failure indicators:** multiple drafts created in `/clients/X/billing` list; multiple toasts; navigation flickers; URL has wrong invoiceId.

**Severity:** HIGH.

---

## A10. Rapid Click on "הנפק וסיים"

**Steps:**
1. Add a line, click "הנפק וסיים", click "הנפק חשבונית" in the ConfirmPop **as fast as possible 5×**.

**Expected:** One invoice issued. Document number incremented once. Land on issued view with `?send=1` removed. Send modal auto-opens.

**Possible failure indicators:** multiple invoices issued (different document numbers in /billing list); confirm dialog stays open; number skipped (e.g. 23 then 25, missing 24).

**Severity:** CRITICAL.

---

## A11. Refresh During Save Draft

**Steps:**
1. Fill `/billing/new` with 3 lines.
2. Click "שמור טיוטה".
3. **Immediately hit F5** before the toast appears.

**Expected:** Either the save completed (you'll see the draft in `/clients/X/billing`) or it didn't (you're back on `/new` with sessionStorage-recovered state). No partial drafts.

**Possible failure indicators:** draft exists server-side but page shows empty form with no recovery; or recovery overwrites the saved draft on rehydration.

**Severity:** HIGH — checks H3 + M1 together.

---

## A12. Refresh During Issue Flow

**Steps:**
1. Fill `/billing/new` with 1 line.
2. Click "הנפק וסיים" → confirm.
3. **Hit F5 between confirm click and toast**.

**Expected:** Either fully issued (number assigned, appears in list as issued) or partial-save (draft exists, can be issued from draft editor). NEVER partial-line draft.

**Possible failure indicators:** orphan draft with no lines; issuance counted twice; numbering gap; sessionStorage state stale.

**Severity:** CRITICAL.

---

## A13. Browser Back After Save

**Steps:**
1. Save a draft on `/clients/X/billing/new`.
2. Land on `/clients/X/billing/<id>`.
3. Press browser back.

**Expected:** Return to `/clients/X/billing/new` with a CLEAN form (sessionStorage was cleared after success).

**Possible failure indicators:** form repopulates with the just-saved data; the same draft can be saved twice as a duplicate.

**Severity:** HIGH — verifies H3 clear-on-success.

---

## A14. Two Tabs, Same Lead, Different Drafts

**Steps:**
1. Tab A: `/clients/X/billing/new`, type 2 lines.
2. Tab B (same browser session): `/clients/X/billing/new`.
3. Note what Tab B shows.

**Expected:** Tab B hydrates from sessionStorage and shows Tab A's lines (sessionStorage is per-tab in some browsers, shared in others — note the actual behavior).

**Possible failure indicators:** Tab B blanks Tab A's draft on hydrate-race; saving in Tab A leaves Tab B with stale duplicate.

**Severity:** MEDIUM — known sessionStorage scoping ambiguity.

---

## A15. Two Tabs, Different Leads, Drafts Stay Separate

**Steps:**
1. Tab A: `/clients/X/billing/new` with line "A".
2. Tab B: `/clients/Y/billing/new` with line "B".
3. Save Tab A.

**Expected:** Tab A goes to its issued page. Tab B still shows line "B" untouched.

**Possible failure indicators:** Tab B's draft cleared; storage keys collide.

**Severity:** MEDIUM.

---

## A16. Keyboard-Only Invoice Creation

**Steps:**
1. Reload `/billing/new`.
2. Without touching the mouse, Tab through to the line-title field.
3. Type a line, Tab through qty/price/discount.
4. Enter to commit.
5. Tab to "שמור טיוטה", press Enter.

**Expected:** Full flow completable via keyboard. Save triggers.

**Possible failure indicators:** focus traps; sticky bar buttons unreachable; Enter on something else triggers wrong action.

**Severity:** HIGH — accessibility + power user.

---

## A17. Sticky Footer — Sidebar Collision (RTL)

**Steps:**
1. Hover the right-side Nav so it expands.
2. Look at the sticky footer "ביטול" button position.

**Expected:** "ביטול" stays visible while Nav expands (it sits under the Nav's 50px column, but ps-20 padding keeps the button text visible).

**Possible failure indicators:** button text clipped behind expanded Nav; jumps on hover; Nav covers part of "ביטול".

**Severity:** MEDIUM — recently fixed; verify.

---

## A18. Sticky Footer Doesn't Scroll

**Steps:**
1. On `/billing/new`, expand "אפשרויות נוספות".
2. Scroll page down past the totals card.

**Expected:** Sticky footer stays glued to viewport bottom. `pb-28` keeps the last section reachable.

**Possible failure indicators:** footer scrolls away; last content cut off behind footer; scroll jumps.

**Severity:** HIGH.

---

## A19. Long Invoice — 50 Lines

**Steps:**
1. On `/billing/new` add 50 lines (use rapid Enter pattern from A5).
2. Watch typing latency in the last 10 rows.
3. Save the draft.

**Expected:** Typing remains responsive (<100ms perceived). All 50 lines persist atomically (M1 — transaction). Draft editor reloads in <2s.

**Possible failure indicators:** typing lag in late rows; save hangs; only some lines persist; layout breaks.

**Severity:** HIGH — performance + transaction.

---

## A20. Long Invoice — 100 Lines

**Steps:**
1. Same as A19 but to 100 lines.

**Expected:** Still functional. Some lag tolerable.

**Possible failure indicators:** browser tab unresponsive; save returns 'failed'; partial draft (M1 break).

**Severity:** MEDIUM — stress test.

---

## A21. Slow Network — Save During 3G Throttle

**Steps:**
1. DevTools → Network → "Slow 3G".
2. Fill 3 lines, click "שמור טיוטה".
3. Watch for ~5 seconds while save is in flight.

**Expected:** Button disabled (`busy` state). No duplicate sends. Eventually success toast and navigate.

**Possible failure indicators:** spinner endless; user can re-click and duplicate; toast never appears; aborted requests leave orphan drafts.

**Severity:** HIGH.

---

## A22. Slow Network — Refresh Mid-Save

**Steps:**
1. Throttle to Slow 3G.
2. Click "שמור טיוטה".
3. F5 while save is in flight.

**Expected:** On reload, either the draft exists (server completed) or it doesn't (server aborted). sessionStorage should have the data so the page rehydrates either way.

**Possible failure indicators:** double drafts; data lost; sessionStorage corrupted.

**Severity:** HIGH.

---

## A23. Issue → Land On Frozen View

**Steps:**
1. Save a draft.
2. Go to the draft editor.
3. Click "הנפק וסיים" → confirm.

**Expected:** Document number assigned (visible in URL or top hero). Draft editor disappears. Frozen view loads with dark hero band. SendInvoiceModal auto-opens (`?send=1`).

**Possible failure indicators:** still shows draft editor after issue; document number missing; send modal doesn't open; URL still has `?send=1`.

**Severity:** CRITICAL.

---

## A24. Issued Invoice Is Immutable

**Steps:**
1. Open an already-issued invoice.
2. Try to manipulate the URL to access the draft editor (you shouldn't be able to).
3. Look for any edit-shaped UI (line inputs, "delete draft" button).

**Expected:** Read-only view only. No mutation handlers. No way to edit lines / change totals.

**Possible failure indicators:** edit fields somehow rendered; line totals editable; "delete draft" button visible.

**Severity:** CRITICAL — legal-doc immutability.

---

## A25. Send Invoice — Happy Path

**Steps:**
1. On an issued invoice with a ready PDF, click "שלח חשבונית".
2. Modal pre-fills recipient email.
3. Click send.

**Expected:** Success toast. Modal closes. Timeline shows new "invoice.sent" event. Customer receives email (check Resend dashboard if accessible).

**Possible failure indicators:** modal stuck; email not delivered; timeline doesn't update; pdf_not_ready returned.

**Severity:** CRITICAL.

---

## A26. Send Cooldown (H6) — Rapid Re-send

**Steps:**
1. Send an invoice successfully (A25).
2. Open send modal again immediately.
3. Click send within 30 seconds.

**Expected:** Server rejects with `rate_limited` reason. UI shows generic error toast (we noted the client message is still generic — that's a known polish gap).

**Possible failure indicators:** second email actually sent; cooldown miscounts; cooldown lasts forever.

**Severity:** HIGH — H6 verification.

---

## A27. Send Cooldown — Wait 31 Seconds, Retry

**Steps:**
1. Send invoice (A25).
2. Wait 31 seconds.
3. Send again.

**Expected:** Succeeds.

**Possible failure indicators:** still rate-limited; cooldown calculation off.

**Severity:** HIGH.

---

## A28. Send Without Ready PDF

**Steps:**
1. Issue an invoice. Immediately (before PDF generates) click "שלח חשבונית".
2. Try to send.

**Expected:** Server returns `pdf_not_ready`. UI message indicates PDF still generating.

**Possible failure indicators:** broken email with no attachment URL; server crash; silent failure.

**Severity:** HIGH.

---

## A29. Duplicate Invoice → New Draft

**Steps:**
1. From an issued invoice, click "שכפל" / "Duplicate".
2. Verify a new draft is created with the same lines.

**Expected:** New draft visible in `/clients/X/billing` list. Lines copied, NOT linked to original. Issued original unchanged.

**Possible failure indicators:** new draft missing lines; original mutated; double-click duplicates twice.

**Severity:** HIGH.

---

## A30. Permission Boundary — Non-Admin Tries Other Lead's Invoice

**Steps (requires non-admin test user):**
1. Sign in as MNGR or AGNT.
2. Identify a lead they DON'T have permission to (e.g. assigned to a different user).
3. Navigate directly to `/clients/<that-lead-id>/billing` and `/clients/<that-lead-id>/billing/<some-invoice-id>`.

**Expected:** 404 / NotFound for both. No invoice data visible.

**Possible failure indicators:** invoices listed; invoice detail page renders; legalNameSnapshot visible.

**Severity:** CRITICAL — C1 verification.

---

## A31. Permission Boundary — Cross-Lead Issue Bypass

**Steps (requires non-admin):**
1. Sign in as non-admin.
2. Open browser dev console.
3. Find a lead they CAN access (lead A) and an invoice ID for a different lead (lead B, same agency) they can't access.
4. Manually call the server action via fetch with `{ invoiceId: B_invoice_id, leadId: A_id }`.

**Expected:** Action returns `invoice_not_found`. B's invoice stays draft.

**Possible failure indicators:** B's invoice gets issued; document number allocated for the wrong lead.

**Severity:** CRITICAL — C2 verification. **May be hard to test manually**; primarily covered in Playwright.

---

## A32. Mobile — Viewport < 768px

**Steps:**
1. DevTools responsive mode, iPhone 12 (390×844).
2. Navigate to `/clients/X/billing/new`.

**Expected:** The site shows a "desktop only" mobile-block (per `MobileBlock.tsx`).

**Possible failure indicators:** mobile-block doesn't show; layout cramped instead; sidebar visible on mobile.

**Severity:** LOW (intentional design) — but verify the gate works.

---

## A33. Tablet — Viewport 768–1024px

**Steps:**
1. DevTools, iPad (820×1180) portrait.
2. Navigate billing flow.

**Expected:** Per `desktop:` Tailwind breakpoint (1000px+), `1000px` threshold. iPad portrait might be below. Mobile-block should engage.

**Possible failure indicators:** ambiguous layout; nav misbehaves; picker dropdown overflows viewport.

**Severity:** LOW–MEDIUM.

---

## A34. Modal Spam — Open/Close ConfirmPop

**Steps:**
1. On draft editor, click "הנפק וסיים".
2. Click X to close, immediately click "הנפק וסיים" again. Repeat 5×.

**Expected:** Modal opens and closes cleanly. No stuck-open state. No double modals.

**Possible failure indicators:** modal lingers; backdrop persists after close; modal stacked twice.

**Severity:** MEDIUM.

---

## A35. PDF Generation Status (M4-ish)

**Steps:**
1. Issue a fresh invoice.
2. Observe the PDF status chip on the issued page.
3. Wait ~10s.

**Expected:** Status starts as "scheduled" or "rendering", eventually becomes "ready". Currently **the user must manually refresh** — note if so (we flagged H4 but didn't fix).

**Possible failure indicators:** stuck on "rendering" indefinitely; "failed" with no retry option; UI never updates.

**Severity:** MEDIUM (known unfixed).

---

## A36. PDF Re-render After Failure

**Steps:**
1. If a PDF failed (or simulate by issuing then triggering a render failure), click "נסה שוב".

**Expected:** PDF schedule re-fires. After refresh, status moves to "ready".

**Possible failure indicators:** button does nothing; multiple renders queued; PDF URL stays stale.

**Severity:** HIGH.

---

## A37. Delete Draft

**Steps:**
1. On a draft editor, click "מחק טיוטה" → confirm.

**Expected:** Toast success. Navigate to `/clients/X/billing` list. Draft is gone. Lines also deleted (cascade).

**Possible failure indicators:** draft remains; lines orphaned; list shows ghost row.

**Severity:** HIGH.

---

## A38. Delete Draft During Save

**Steps:**
1. On draft editor, in one tab click "מחק טיוטה" → confirm.
2. In another tab on the same draft, try to edit a line.

**Expected:** Tab 1 deletes. Tab 2's edit returns `invoice_not_found` or `not_draft`. No crash.

**Possible failure indicators:** silent zombie state; tab 2 still shows lines that no longer exist; refresh causes white screen.

**Severity:** MEDIUM.

---

## A39. Server Action Failure — Network Off

**Steps:**
1. On `/billing/new` with lines, DevTools → Network → "Offline".
2. Click "שמור טיוטה".

**Expected:** Error toast "שמירת הטיוטה נכשלה". Lines remain in the editor. sessionStorage preserved. Re-enable network, click save — succeeds.

**Possible failure indicators:** silent hang; lines disappear; sessionStorage cleared on failure.

**Severity:** HIGH.

---

## A40. End-to-End Smoke (Don't Skip)

**Steps:**
1. Create new lead via picker → land on its `/billing/new`.
2. Add 3 lines, set due date.
3. Save draft, verify on draft editor.
4. Edit one line's quantity, watch it persist on refresh.
5. Issue & finish.
6. Verify frozen view + send modal auto-opens.
7. Send the email.
8. Confirm timeline shows: created, issued, sent.

**Expected:** Every step succeeds.

**Possible failure indicators:** anything misses; timeline missing events; numbers don't tally.

**Severity:** CRITICAL.

---

# Quick Triage Order

If you have 30 minutes, do these in order: **A1, A6, A7, A10, A11, A12, A23, A24, A25, A26, A30, A40**.

These cover: happy path, validation, race conditions, permissions, immutability, smoke.
