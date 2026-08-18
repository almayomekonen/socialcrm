/**
 * One-off local General Mode E2E. Does not start a server — expects pnpm dev on :3000.
 * Usage: npx tsx scripts/e2e/general-mode-business.e2e.ts
 *
 * Mints a live session cookie for an existing ADMIN with leads. Does not write
 * that cookie into the repo.
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { db } from '../../config/db'

const BASE = 'http://localhost:3000'

const QUESTIONS = [
  'מי שלח לי הודעה לאחרונה?',
  'מי מחכה לי בוואטסאפ?',
  'מה הכי דחוף?',
  'למה?',
  'מי עוד?',
  'מה מצב העסק?',
  'מה אני יכול לעשות כדי לקדם את העסק?',
  'כמה כסף עשיתי?',
  'מה עוד?',
]

const BANNED = [
  'סיכוי גבוה',
  'ליד חם',
  'לקוח חם',
  'יגדיל המרות',
  'המרה נמוכה',
  'מפסיד כסף',
  '₪',
]

type UserRow = {
  id: number
  agencyId: number
  role: string
  suspended?: boolean
  sessionVersion?: number
}

async function pickUser(): Promise<UserRow> {
  const preferred = await db('users')
    .select('id', 'agencyId', 'role', 'suspended', 'sessionVersion')
    .whereIn('id', [138, 264])
    .whereNot({ suspended: true })
    .whereNotNull('agencyId')
  const withLeads = async (u: UserRow) => {
    const row = await db('clients').where({ agencyId: u.agencyId }).first('id')
    return Boolean(row)
  }
  for (const id of [138, 264]) {
    const u = preferred.find((r: UserRow) => r.id === id)
    if (u && (await withLeads(u))) return u
  }
  const admins = await db('users')
    .select('id', 'agencyId', 'role', 'suspended', 'sessionVersion')
    .where({ role: 'ADMIN' })
    .whereNot({ suspended: true })
    .whereNotNull('agencyId')
    .orderBy('id', 'asc')
  for (const u of admins as UserRow[]) {
    if (await withLeads(u)) return u
  }
  throw new Error('no ADMIN with leads found for local E2E')
}

async function mintToken(user: UserRow): Promise<string> {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET missing')
  const key = new TextEncoder().encode(secret)
  const sv = Number(user.sessionVersion ?? 0)
  return new SignJWT({ id: user.id, sv, typ: 'session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key)
}

async function main() {
  const user = await pickUser()
  const token = await mintToken(user)
  console.log(`session user=${user.id} agency=${user.agencyId} role=${user.role}`)

  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({
    locale: 'he-IL',
    viewport: { width: 1400, height: 900 },
  })
  await context.addCookies([
    {
      name: 'user',
      value: token,
      url: BASE,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)

  await page.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => !url.pathname.includes('/auth') && !url.pathname.includes('/login'), {
    timeout: 20_000,
  })

  const trigger = page.getByRole('button', { name: 'עוזר חכם' })
  await trigger.waitFor({ state: 'visible' })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()

  const panel = page.getByRole('complementary', { name: 'עוזר חכם' })
  await panel.waitFor({ state: 'visible' })
  const box = page.getByPlaceholder('שאל את העוזר…')
  await box.waitFor({ state: 'visible', timeout: 25_000 })

  const transcript: { q: string; a: string }[] = []

  for (const q of QUESTIONS) {
    const before = await page.locator('.gm-answer-enter').count()
    await box.fill(q)
    await box.press('Enter')
    await page.waitForFunction(
      (prev) => document.querySelectorAll('.gm-answer-enter').length > prev,
      before,
      { timeout: 40_000 },
    )
    const last = page.locator('.gm-answer-enter').last()
    const a = ((await last.innerText()) ?? '').trim()
    transcript.push({ q, a })
    console.log('\nQ:', q)
    console.log('A:', a.slice(0, 1200))
  }

  const bannedHits = transcript.flatMap((t) => BANNED.filter((b) => t.a.includes(b)).map((b) => ({ q: t.q, b })))
  const byQ = Object.fromEntries(transcript.map((t) => [t.q, t.a]))
  const recent = byQ['מי שלח לי הודעה לאחרונה?'] ?? ''
  const waiting = byQ['מי מחכה לי בוואטסאפ?'] ?? ''
  const urgent = byQ['מה הכי דחוף?'] ?? ''
  const why = byQ['למה?'] ?? ''
  const revenue = byQ['כמה כסף עשיתי?'] ?? ''
  const more = byQ['מה עוד?'] ?? ''
  const semantic: string[] = []
  if (recent.includes('מי שממתין למענה')) semantic.push('recent used waiting header')
  if (recent.includes('הכי דחוף כרגע')) semantic.push('attention leaked into recent')
  if (!recent.includes('מי ששלח הודעה') && !recent.includes('אין כרגע הודעות וואטסאפ נכנסות')) {
    semantic.push('recent missing recency framing')
  }
  if (waiting.includes('מי ששלח הודעה בוואטסאפ לאחרונה')) semantic.push('waiting used recency header')
  if (!waiting.includes('ממתין') && !waiting.includes('אין כרגע שיחות')) semantic.push('waiting missing waiting framing')
  if (recent === waiting) semantic.push('recent answer identical to waiting')
  if (!urgent.includes('הכי דחוף') && !urgent.includes('הכול תחת שליטה')) semantic.push('urgency missing ranking')
  if (why.includes('לא בטוח שהבנתי')) semantic.push('why fell through to clarify')
  if (!revenue.includes('הכנסה') && !revenue.includes('כסף')) semantic.push('revenue gap missing')
  if (more.includes('הכי דחוף כרגע')) semantic.push('מה עוד resurrected ranking')

  const out = {
    at: new Date().toISOString(),
    user: { id: user.id, agencyId: user.agencyId, role: user.role },
    bannedHits,
    semantic,
    transcript,
  }
  writeFileSync('/tmp/general-mode-business-e2e.json', JSON.stringify(out, null, 2))
  console.log('\n--- bannedHits', bannedHits.length, bannedHits)
  console.log('--- semantic', semantic.length, semantic)
  await browser.close()
  await db.destroy()
  if (bannedHits.length > 0 || semantic.length > 0) process.exit(2)
}

main().catch(async (err) => {
  console.error(err)
  try {
    await db.destroy()
  } catch {
    // ignore
  }
  process.exit(1)
})
