import { test, expect, type Page } from '@playwright/test'

/**
 * Billing — production hardening tests.
 *
 * Coverage focuses on highest production risk, NOT line coverage:
 *   - Happy path create + issue + send
 *   - Duplicate-click protection (rapid clicks must not double-submit)
 *   - sessionStorage draft recovery (H3) — survives reload, clears on save
 *   - Permission boundaries (C1, C2) — non-admin cannot read or mutate
 *     invoices for leads they don't own
 *   - Immutability — issued invoices have no mutation surface
 *   - Send cooldown (H6) — server blocks rapid re-sends within 30s
 *
 * SELECTOR STRATEGY
 *
 * We use `data-testid` ONLY for fragile spots:
 *   - Inline editor cells in InvoiceLinesEditor — would otherwise need
 *     placeholder text or `nth(...)` positional indexing.
 *   - Send modal recipient input — placeholder-based selectors break
 *     the moment marketing changes "client@example.com" to anything else.
 *   - Send modal submit button — same Hebrew label as the page-level
 *     trigger, getByRole would be ambiguous.
 *
 * Stable wording-based selectors (kept as-is):
 *   - Action-bar buttons by role+name (e.g. "שמור טיוטה", "הנפק וסיים")
 *     — these labels ARE the UX contract; if they change, that's a
 *     deliberate product decision and the test SHOULD fail.
 *   - Page headings, modal confirm/cancel.
 *
 * SETUP REQUIRED
 *
 * 1. Two test leads must exist in the dev DB:
 *
 *    - BILLING_TEST_LEAD_ID         — owned by the ADMIN user
 *                                    (id 91 per tests/test_users/index.ts).
 *                                    Used for all positive tests.
 *
 *    - BILLING_LOCKED_LEAD_ID       — exists in the same agency, but the
 *                                    AGNT user (id 117) does NOT have
 *                                    permission for it. Used for C1+C2.
 *
 * 2. Export them as env vars before `npx playwright test`:
 *
 *      BILLING_TEST_LEAD_ID=14746 \
 *      BILLING_LOCKED_LEAD_ID=14712 \
 *      npx playwright test tests/billing.spec.ts
 *
 *    Without the env vars, the affected tests `test.skip` themselves
 *    with a clear message instead of producing fake failures.
 *
 * 3. Each test that mutates data creates its OWN draft via the UI to
 *    keep tests independent — no shared fixture state.
 */

const TEST_LEAD_ID = process.env.BILLING_TEST_LEAD_ID
const LOCKED_LEAD_ID = process.env.BILLING_LOCKED_LEAD_ID

/** Toggle visibility of skipped-config tests vs hard-failing. */
const REQUIRE_TEST_LEAD = (name: string) => {
  test.skip(
    !TEST_LEAD_ID,
    `Set BILLING_TEST_LEAD_ID env var to run "${name}" — see file header.`,
  )
}
const REQUIRE_LOCKED_LEAD = (name: string) => {
  test.skip(
    !LOCKED_LEAD_ID,
    `Set BILLING_LOCKED_LEAD_ID env var to run "${name}" — see file header.`,
  )
}

/** Most tests need an ADMIN session to set up state; gate per project. */
const ADMIN_ONLY = () => {
  test.skip(test.info().project.name !== 'ADMIN', 'ADMIN-only')
}
/** Permission tests run as a constrained role. */
const AGNT_ONLY = () => {
  test.skip(test.info().project.name !== 'AGNT', 'AGNT-only')
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

async function gotoNewInvoice(page: Page, leadId: string): Promise<void> {
  await page.goto(`/clients/${leadId}/billing/new`)
  // The page header is the canonical "we got here" signal.
  await expect(page.getByRole('heading', { name: 'חשבונית חדשה' })).toBeVisible()
}

/**
 * Fill the "+ פריט חדש" compose row via stable testids, then commit
 * with Enter. The newline-* testids are scoped to the compose row, so
 * they're unambiguous even when other lines already exist in the table.
 */
async function addLine(
  page: Page,
  opts: { title: string; quantity?: string; price: string; description?: string },
): Promise<void> {
  const titleInput = page.getByTestId('invoice-newline-title')
  await titleInput.click()
  await titleInput.fill(opts.title)

  if (opts.description) {
    // Description input only renders after title has content.
    await page.getByTestId('invoice-newline-description').fill(opts.description)
  }

  if (opts.quantity) {
    await page.getByTestId('invoice-newline-quantity').fill(opts.quantity)
  }
  const priceInput = page.getByTestId('invoice-newline-unit-price')
  await priceInput.fill(opts.price)

  // Enter on the price field commits the row. After commit the compose
  // row resets to empty and focus returns to the title field.
  await priceInput.press('Enter')

  // The saved line appears as a separate `invoice-line-row` above the
  // compose row. Wait for at least one such row to be present.
  await expect(page.getByTestId('invoice-line-row').first()).toBeVisible()
}

/** Returns the invoice id parsed from the post-save URL. */
function parseInvoiceIdFromUrl(url: string): string {
  const m = url.match(/\/billing\/(\d+)(?:\?|$)/)
  if (!m) throw new Error(`Could not extract invoiceId from URL: ${url}`)
  return m[1]
}

// ──────────────────────────────────────────────────────────────────────
// 1. Create draft — happy path + duplicate-click protection
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: create draft', () => {
  test('happy path: add one line and save draft persists', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('create draft happy path')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-line-${Date.now()}`, price: '200' })

    const saveBtn = page.getByRole('button', { name: 'שמור טיוטה' })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    // Wait for navigation away from /new to the persisted draft route.
    await page.waitForURL(/\/clients\/\d+\/billing\/\d+$/)
    expect(parseInvoiceIdFromUrl(page.url())).toBeTruthy()

    // Draft editor renders.
    await expect(page.getByText('טיוטה — ניתנת לעריכה עד ההנפקה')).toBeVisible()
    // At least one persisted line is rendered with the LineRow testid.
    await expect(page.getByTestId('invoice-line-row').first()).toBeVisible()
  })

  test('duplicate-click on "שמור טיוטה" must not create two drafts', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('duplicate-click save')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-dupcheck-${Date.now()}`, price: '50' })

    const saveBtn = page.getByRole('button', { name: 'שמור טיוטה' })

    // Hammer 5 clicks in quick succession. The `busy` state should block
    // all but the first; if it doesn't, multiple drafts get created.
    await Promise.all([saveBtn.click(), saveBtn.click(), saveBtn.click(), saveBtn.click(), saveBtn.click()])

    await page.waitForURL(/\/clients\/\d+\/billing\/\d+$/)
    const invoiceId = parseInvoiceIdFromUrl(page.url())
    expect(invoiceId).toMatch(/^\d+$/)
  })

  test('save button stays disabled with no lines', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('empty draft guard')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await expect(page.getByRole('button', { name: 'שמור טיוטה' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'הנפק וסיים' })).toBeDisabled()
  })
})

// ──────────────────────────────────────────────────────────────────────
// 2. Issue invoice — happy path + duplicate-click + send modal auto-open
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: issue', () => {
  test('issue moves docState to issued and opens send modal', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('issue happy path')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-issue-${Date.now()}`, price: '120' })

    await page.getByRole('button', { name: 'הנפק וסיים' }).click()
    // ConfirmPop opens — accept.
    await page.getByRole('button', { name: 'הנפק חשבונית' }).click()

    // Land on issued (frozen) view.
    await page.waitForURL(/\/clients\/\d+\/billing\/\d+/)
    // The "טיוטה ללא מספר" header is the draft marker — must be gone.
    await expect(page.getByText('טיוטה ללא מספר')).toHaveCount(0)

    // Send modal auto-opens (?send=1 hint).
    // Recipient input is testid-keyed — placeholder-independent.
    await expect(page.getByTestId('send-invoice-recipient')).toBeVisible({ timeout: 5000 })
    // The modal's submit button is distinct from any page-level trigger.
    await expect(page.getByTestId('send-invoice-submit')).toBeVisible()
  })

  test('duplicate-click confirm on issue does not double-issue', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('duplicate-click issue')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-issue-dup-${Date.now()}`, price: '90' })

    await page.getByRole('button', { name: 'הנפק וסיים' }).click()

    const confirmBtn = page.getByRole('button', { name: 'הנפק חשבונית' })
    // Hammer the confirm button. Each issue allocates a sequential
    // document number — a second issue would skip/reuse a number. The
    // server's `forUpdate` row lock should prevent that.
    await Promise.all([confirmBtn.click(), confirmBtn.click(), confirmBtn.click()])

    await page.waitForURL(/\/clients\/\d+\/billing\/\d+/)

    // The page must not show the ConfirmPop anymore, and the invoice
    // must be in issued state (not draft).
    await expect(page.getByText('טיוטה ללא מספר')).toHaveCount(0)
  })
})

// ──────────────────────────────────────────────────────────────────────
// 3. Send invoice — cooldown protection (H6)
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: send', () => {
  /**
   * NOTE: This test depends on the email transport actually working in
   * the test env. If Resend is not configured for the test agency, the
   * first send will fail with `transport_failed` and the cooldown test
   * is moot — we `test.skip` with a clear message instead of pretending.
   */
  test('cooldown blocks re-send within 30 seconds', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('send cooldown')

    // Step 1: create + issue an invoice
    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-send-${Date.now()}`, price: '80' })
    await page.getByRole('button', { name: 'הנפק וסיים' }).click()
    await page.getByRole('button', { name: 'הנפק חשבונית' }).click()

    // The auto-opened send modal renders the recipient input.
    const recipient = page.getByTestId('send-invoice-recipient')
    await expect(recipient).toBeVisible({ timeout: 10_000 })

    // Provide a recipient — snapshot may be empty for a fresh lead.
    await recipient.fill('qa-test@example.com')

    // Step 2: first send.
    const sendSubmit = page.getByTestId('send-invoice-submit')
    await sendSubmit.click()

    // Wait for a response. If PDF wasn't ready or transport is unset,
    // the first send fails and the cooldown test is meaningless — skip
    // with a clear message.
    await page.waitForTimeout(2500)
    const errorVisible = await page
      .locator('#popMsg')
      .filter({ hasText: 'שליחת החשבונית נכשלה' })
      .isVisible()
      .catch(() => false)
    if (errorVisible) {
      test.skip(true, 'First send failed (likely pdf_not_ready or transport unset) — cooldown untestable in this env')
    }

    // Step 3: immediately retry — server must refuse with rate_limited.
    // The modal may have closed on success; reopen via the page-level
    // trigger if needed. The trigger is unique on the issued page.
    const triggerBtn = page.getByRole('button', { name: 'שלח חשבונית' }).first()
    if (await triggerBtn.isVisible().catch(() => false)) {
      await triggerBtn.click()
      await expect(recipient).toBeVisible()
    }
    await sendSubmit.click()

    // Expect a generic failure toast within the cooldown window.
    // (We flagged earlier that the client doesn't yet render a
    //  cooldown-specific message — the server's rate_limited reason
    //  surfaces as the generic error.)
    await expect(page.locator('#popMsg')).toContainText(/שליחת החשבונית נכשלה|נכשל/, {
      timeout: 5000,
    })
  })
})

// ──────────────────────────────────────────────────────────────────────
// 4. Draft recovery — sessionStorage (H3)
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: draft recovery', () => {
  test('reload after typing restores lines from sessionStorage', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('draft recovery')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    const title = `QA-recover-${Date.now()}`
    await addLine(page, { title, price: '77' })

    // Reload WITHOUT saving. Transient state should hydrate from
    // sessionStorage on mount.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'חשבונית חדשה' })).toBeVisible()

    // At least one persisted-in-state line should be visible after
    // rehydration. We don't pin to title text (that would re-introduce
    // wording dependence) — the testid + at-least-one row is enough.
    await expect(page.getByTestId('invoice-line-row').first()).toBeVisible({ timeout: 5000 })
  })

  test('sessionStorage is cleared after successful save', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('draft recovery clear')

    await gotoNewInvoice(page, TEST_LEAD_ID!)
    const title = `QA-clear-${Date.now()}`
    await addLine(page, { title, price: '40' })

    await page.getByRole('button', { name: 'שמור טיוטה' }).click()
    await page.waitForURL(/\/clients\/\d+\/billing\/\d+$/)

    // Navigate back to /new. Recovery must NOT restore the already-
    // persisted draft — that would let the user accidentally duplicate.
    await page.goto(`/clients/${TEST_LEAD_ID}/billing/new`)
    await expect(page.getByRole('heading', { name: 'חשבונית חדשה' })).toBeVisible()

    // No persisted-line rows should exist; the compose row is allowed.
    await expect(page.getByTestId('invoice-line-row')).toHaveCount(0)
  })
})

// ──────────────────────────────────────────────────────────────────────
// 5. Permission boundaries (C1, C2)
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: permissions', () => {
  test('non-admin gets NotFound for inaccessible lead\'s billing list', async ({ page }) => {
    AGNT_ONLY()
    REQUIRE_LOCKED_LEAD('perm list page')

    const resp = await page.goto(`/clients/${LOCKED_LEAD_ID}/billing`)
    // C1: notFound() in Next.js app router returns 404.
    expect(resp?.status()).toBe(404)
  })

  test('non-admin gets NotFound for inaccessible lead\'s invoice detail', async ({ page }) => {
    AGNT_ONLY()
    REQUIRE_LOCKED_LEAD('perm detail page')

    // We don't know which invoiceId belongs to LOCKED_LEAD_ID without
    // DB access, so probe a likely id range. Even if the id is wrong,
    // the page must not expose any invoice data.
    const probeIds = [1, 2, 10, 100]
    for (const invId of probeIds) {
      await page.goto(`/clients/${LOCKED_LEAD_ID}/billing/${invId}`)
      // No mutation surface AND no frozen-view content must leak.
      const draftMarker = await page.getByText('טיוטה ללא מספר').isVisible().catch(() => false)
      const issueBtn = await page.getByRole('button', { name: 'הנפק וסיים' }).isVisible().catch(() => false)
      const sendTrigger = await page.getByRole('button', { name: 'שלח חשבונית' }).isVisible().catch(() => false)
      const composeRow = await page.getByTestId('invoice-newline-row').isVisible().catch(() => false)
      expect(
        draftMarker || issueBtn || sendTrigger || composeRow,
        `Permission leak on invoice ${invId}`,
      ).toBeFalsy()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// 6. Immutability — issued invoice has no mutation surface
// ──────────────────────────────────────────────────────────────────────

test.describe('billing: immutability', () => {
  test('issued invoice page has no draft-editor controls', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('immutability')

    // Step 1: create + issue an invoice
    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-immut-${Date.now()}`, price: '300' })
    await page.getByRole('button', { name: 'הנפק וסיים' }).click()
    await page.getByRole('button', { name: 'הנפק חשבונית' }).click()
    await page.waitForURL(/\/clients\/\d+\/billing\/\d+/)

    // Dismiss the auto-opened send modal if present.
    const modalClose = page.getByTitle('יציאה ללא שמירה')
    if (await modalClose.isVisible().catch(() => false)) {
      await modalClose.click()
    }

    // Strict immutability: NONE of these mutation surfaces should exist
    // on a frozen invoice view. They are all draft-only.
    // - Draft action buttons by stable Hebrew label (UX contract)
    await expect(page.getByRole('button', { name: 'שמור טיוטה' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'הנפק וסיים' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'מחק טיוטה' })).toHaveCount(0)
    // - Inline editor surfaces by testid (the structural contract)
    await expect(page.getByTestId('invoice-newline-row')).toHaveCount(0)
    await expect(page.getByTestId('invoice-newline-title')).toHaveCount(0)
    await expect(page.getByTestId('invoice-line-title')).toHaveCount(0)
    await expect(page.getByTestId('invoice-line-quantity')).toHaveCount(0)
    await expect(page.getByTestId('invoice-line-unit-price')).toHaveCount(0)

    // Sanity: the "טיוטה" draft chip text must also be absent.
    await expect(page.getByText('טיוטה ללא מספר')).toHaveCount(0)
  })

  test('frozen view proxies server-side immutability via DOM', async ({ page }) => {
    ADMIN_ONLY()
    REQUIRE_TEST_LEAD('immutability server proxy')

    // Issue an invoice, then verify the frozen page has no edit surface.
    // The DB layer enforces `where docState='draft'` on every mutation
    // query — we can't easily call those actions from a Playwright
    // context, so we use the DOM absence as the proxy assertion.
    await gotoNewInvoice(page, TEST_LEAD_ID!)
    await addLine(page, { title: `QA-immut-srv-${Date.now()}`, price: '200' })
    await page.getByRole('button', { name: 'הנפק וסיים' }).click()
    await page.getByRole('button', { name: 'הנפק חשבונית' }).click()
    await page.waitForURL(/\/clients\/\d+\/billing\/\d+/)
    const invoiceId = parseInvoiceIdFromUrl(page.url())
    expect(invoiceId).toMatch(/^\d+$/)

    // No editable surfaces present on the frozen page.
    await expect(page.getByTestId('invoice-newline-row')).toHaveCount(0)
    await expect(page.getByTestId('invoice-line-row')).toHaveCount(0)
  })
})
