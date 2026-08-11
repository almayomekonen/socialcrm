/**
 * Local functional smoke for Admin Support reply + status.
 * Run: npx tsx scripts/support-phase3-local-smoke.mjs
 */
import { chromium } from 'playwright'
import { SignJWT } from 'jose'
import { config } from 'dotenv'
import { db } from '../config/db'

config({ path: '.env.local' })

const BASE = process.env.BASE_URL || 'http://localhost:3000'

async function mint(user) {
  const key = new TextEncoder().encode(process.env.JWT_SECRET)
  const token = await new SignJWT({
    id: user.id,
    sv: Number(user.sessionVersion ?? 0),
    typ: 'session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d')
    .sign(key)
  return {
    cookies: [
      {
        name: 'user',
        value: token,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 86400,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  }
}

async function main() {
  const owner = await db('users').where({ email: 'alamayo274@gmail.com' }).first()
  if (!owner) throw new Error('owner missing')
  const request = await db('support_requests').where({ id: 1 }).first()
  if (!request) throw new Error('request 1 missing')

  const beforeCount = Number(
    (await db('support_messages').where({ requestId: 1 }).count('id as c').first()).c,
  )

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: await mint(owner),
    locale: 'he-IL',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  await page.goto(`${BASE}/admin/support/1`, { waitUntil: 'load' })
  await page.waitForSelector('#admin-reply')
  const replyText = `בדיקת Phase 3 מקומית · ${new Date().toISOString()}`
  await page.fill('#admin-reply', replyText)
  const [req] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/admin/support/1') && r.request().method() === 'POST',
      { timeout: 15000 },
    ).catch(() => null),
    page.getByRole('button', { name: 'שלח' }).click(),
  ])
  console.log('post', req?.status?.() ?? null)
  try {
    await page.waitForFunction(
      (text) => document.body.innerText.includes(text),
      replyText,
      { timeout: 10000 },
    )
  } catch {
    await page.screenshot({ path: '.playwright-mcp/support-phase3-admin/smoke-fail.png', fullPage: true })
    const alert = await page.locator('[role=alert]').textContent().catch(() => null)
    const body = await page.locator('body').innerText()
    console.log('alert', alert)
    console.log('body snippet', body.slice(-800))
    throw new Error('reply not visible in admin thread')
  }

  // Status → בטיפול
  await page.getByRole('button', { name: 'בטיפול' }).click()
  await page.waitForTimeout(1200)

  const afterCount = Number(
    (await db('support_messages').where({ requestId: 1 }).count('id as c').first()).c,
  )
  const updated = await db('support_requests').where({ id: 1 }).first('status', 'lastMessageAuthorKind')
  const last = await db('support_messages').where({ requestId: 1 }).orderBy('id', 'desc').first()

  // Customer view as same owner (agency 1) should show team label, never authorUserId
  await page.goto(`${BASE}/support/requests/1`, { waitUntil: 'load' })
  await page.waitForTimeout(800)
  const customerBody = await page.locator('body').innerText()
  const leaks = ['authorUserId', 'agencyId', 'diagnostics'].filter((x) => customerBody.includes(x))
  if (!customerBody.includes('צוות SocialCRM')) throw new Error('customer thread missing team label')
  if (!customerBody.includes(replyText)) throw new Error('customer thread missing owner reply')
  if (leaks.length) throw new Error(`customer leak: ${leaks.join(',')}`)

  console.log(
    JSON.stringify(
      {
        ok: true,
        beforeCount,
        afterCount,
        status: updated.status,
        lastAuthorKind: last.authorKind,
        lastAuthorUserId: last.authorUserId,
        customerLeaks: leaks,
      },
      null,
      2,
    ),
  )

  await browser.close()
  await db.destroy()
}

main().catch(async (e) => {
  console.error(e)
  await db.destroy().catch(() => {})
  process.exit(1)
})
