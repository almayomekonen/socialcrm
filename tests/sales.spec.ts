import { test, expect, Page } from '@playwright/test'
import { round } from '@/lib/funcs'

// --- Main Test Loop ---

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  // await loginAs(page, role)
  await page.goto('/')
  await page.getByRole('button', { name: 'הוספת מכירה' }).click()
  await fillClientAndProduct(page)
})

test('should insert single sale', async () => {})

test('should insert collab sale', async ({ page }) => {
  await addCollab(page)
})

test.afterEach(async ({ page }) => {
  await saveAndVerify(page)
})

// --- Helper Functions ---

async function fillClientAndProduct(page: Page, amount = round(Math.random() * 9999)) {
  // Select Client
  await page.getByRole('textbox', { name: 'חיפוש לקוח קיים' }).click()
  await page.getByRole('textbox', { name: 'חיפוש לקוח קיים' }).fill('יהודה צבי')
  await page.getByRole('button', { name: 'יהודה צבי (038084018)' }).click()

  // Fill Product Price
  await page.getByRole('spinbutton').click()
  await page.getByRole('spinbutton').fill(amount.toString())
}

async function addCollab(page: Page) {
  await page.getByRole('button', { name: 'שת"פ' }).click()
  await page.getByRole('textbox', { name: 'חיפוש נציג' }).nth(1).click()
  await page.getByRole('textbox', { name: 'חיפוש נציג' }).nth(1).fill('')
  await page.getByRole('button', { name: 'אורי מונרוב' }).click() // Adjust agent name as needed
  await page.locator('#userPrcnt').click()
  await page.locator('#userPrcnt').fill('77')
}

async function saveAndVerify(page: Page) {
  await page.getByRole('button', { name: 'שמירה', exact: true }).click()
  await expect(page.locator('#popMsg')).toContainText('בוצע בהצלחה!', { timeout: 30000 })
}
