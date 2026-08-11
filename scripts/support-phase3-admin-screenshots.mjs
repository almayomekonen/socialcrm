/**
 * Authenticated Admin Support screenshots (Phase 3).
 *
 * Mints a platform-owner session (alamayo274@gmail.com / id 138 locally) and
 * captures desktop + mobile for /admin, /admin/support, and a request detail.
 * Also verifies a non-owner gets 404 on the Support routes.
 *
 * Run: npx tsx scripts/support-phase3-admin-screenshots.mjs
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { config } from 'dotenv'
import { db } from '../config/db'

config({ path: '.env.local' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', '.playwright-mcp', 'support-phase3-admin')
mkdirSync(outDir, { recursive: true })

const BASE = process.env.BASE_URL || 'http://localhost:3000'

async function mintSessionForUser(user) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  const key = new TextEncoder().encode(secret)
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
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  }
}

async function shoot(page, name, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 45000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitUntil?.('domcontentloaded').catch(() => {})
  await page.waitForTimeout(600)
  const url = page.url()
  const title = await page.title().catch(() => '')
  const h1 = (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? null
  const overflow = await page
    .evaluate(() => {
      const doc = document.documentElement
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowX: doc.scrollWidth > doc.clientWidth + 1,
      }
    })
    .catch(() => ({ scrollWidth: 0, clientWidth: 0, overflowX: false }))
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 800)
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  return {
    name,
    path,
    status: res?.status() ?? null,
    url,
    title,
    h1,
    overflow,
    bodyText,
  }
}

async function runViewport(label, contextOptions, storageState, routes) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    ...contextOptions,
    storageState,
    locale: 'he-IL',
  })
  const page = await context.newPage()
  const results = []
  for (const route of routes) {
    const slug = route
      .replace(/^\//, '')
      .replace(/[?/&=]/g, '-')
      .replace(/-+/g, '-')
      .replace(/-$/, '')
    results.push(await shoot(page, `${label}-${slug || 'root'}`, route))
  }
  await browser.close()
  return results
}

async function main() {
  const ownerEmail = (process.env.PLATFORM_OWNER_EMAILS || 'alamayo274@gmail.com')
    .split(',')[0]
    .trim()
    .toLowerCase()
  const owner =
    (await db('users').where({ email: ownerEmail }).first('id', 'email', 'sessionVersion', 'agencyId')) ||
    (await db('users').where({ id: 138 }).first('id', 'email', 'sessionVersion', 'agencyId'))
  if (!owner) throw new Error('No platform owner user in local DB')

  const nonOwner = await db('users')
    .whereNot({ email: owner.email })
    .whereNotNull('agencyId')
    .orderBy('id', 'desc')
    .first('id', 'email', 'sessionVersion', 'agencyId')

  const request =
    (await db('support_requests').orderBy('lastMessageAt', 'desc').first('id', 'subject', 'status')) ||
    null
  if (!request) throw new Error('No support_requests in local DB — create one via /support/new first')

  const ownerState = await mintSessionForUser(owner)
  const routes = ['/admin', '/admin/support', `/admin/support/${request.id}`]

  const desktop = await runViewport(
    'desktop',
    { viewport: { width: 1440, height: 900 } },
    ownerState,
    routes,
  )
  const mobile = await runViewport('mobile', devices['iPhone 13'], ownerState, routes)

  // Non-owner must not see the Support admin surface (404 / notFound).
  let nonOwnerResult = null
  if (nonOwner) {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      storageState: await mintSessionForUser(nonOwner),
      locale: 'he-IL',
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()
    const res = await page.goto(`${BASE}/admin/support`, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(400)
    nonOwnerResult = {
      email: nonOwner.email,
      status: res?.status() ?? null,
      url: page.url(),
      title: await page.title().catch(() => ''),
      h1: (await page.locator('h1').first().textContent().catch(() => null))?.trim() ?? null,
    }
    await page.screenshot({ path: join(outDir, 'non-owner-admin-support.png'), fullPage: true })
    await browser.close()
  }

  // Reply composer present on detail?
  const detail = desktop.find((r) => r.path.startsWith('/admin/support/'))
  const hasComposer = detail?.bodyText?.includes('כתוב תשובה') ?? false
  const hasStatus = detail?.bodyText?.includes('סטטוס') ?? false
  const hasNav = desktop.some((r) => r.bodyText?.includes('תמיכה'))

  const summary = {
    owner: { id: owner.id, email: owner.email },
    request: { id: request.id, subject: request.subject, status: request.status },
    desktop,
    mobile,
    nonOwnerResult,
    checks: {
      hasNav,
      hasComposer,
      hasStatus,
      desktopOverflow: desktop.filter((r) => r.overflow.overflowX).map((r) => r.name),
      mobileOverflow: mobile.filter((r) => r.overflow.overflowX).map((r) => r.name),
      nonOwnerDenied:
        nonOwnerResult == null
          ? null
          : nonOwnerResult.status === 404 ||
            (nonOwnerResult.h1 || '').toLowerCase().includes('not found') ||
            (nonOwnerResult.title || '').toLowerCase().includes('404'),
    },
  }

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  await db.destroy()
}

main().catch(async (e) => {
  console.error(e)
  await db.destroy().catch(() => {})
  process.exit(1)
})
