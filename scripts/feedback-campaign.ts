import knex from 'knex'
import { appendFileSync, existsSync, readFileSync } from 'fs'
import { renderEmail, renderEmailText } from '@/lib/email/render'
import { sendEmail } from '@/lib/email/sender'
import FeedbackEmail from '@/emails/templates/FeedbackEmail'

const SUBJECT = 'נשמח לשמוע את דעתך על SocialCRM 💙'
const SITE_URL = 'https://getsocialcrm.com'
const REPLY_TO = 'alamayo274@gmail.com'
const SEND_DELAY_MS = 600 // ~1.6/sec, under Resend's default rate limit
const SENT_LOG = 'docs/superpowers/feedback-campaign-sent.log'

const CONFIRM = process.argv.includes('--confirm')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function prodDb() {
  const url = process.env.PROD_DATABASE_URL
  if (!url) {
    console.error('[campaign] PROD_DATABASE_URL is not set — aborting. Put it in .env.prod.local.')
    process.exit(1)
  }
  const u = new URL(url)
  const sslMode = u.searchParams.get('sslmode') ?? 'require'
  u.searchParams.delete('sslmode')
  return knex({
    client: 'pg',
    connection: {
      connectionString: u.toString(),
      ssl: ['require', 'verify-ca', 'verify-full'].includes(sslMode) ? { rejectUnauthorized: false } : false,
    },
    pool: { min: 0, max: 4 },
  })
}

function alreadySent(): Set<string> {
  if (!existsSync(SENT_LOG)) return new Set()
  const lines = readFileSync(SENT_LOG, 'utf8').split('\n').filter(Boolean)
  return new Set(lines.map((l) => l.split('\t')[0]?.toLowerCase()).filter(Boolean))
}

async function run() {
  const db = prodDb()
  try {
    const rows: { email: string | null; suspended: boolean }[] = await db('users').select('email', 'suspended')

    const total = rows.length
    const suspended = rows.filter((r) => r.suspended).length
    const invalid = rows.filter((r) => !r.email || !EMAIL_RE.test(r.email.trim())).length

    // Eligible = active + valid email, de-duplicated case-insensitively.
    const seen = new Set<string>()
    const recipients: string[] = []
    for (const r of rows) {
      if (r.suspended) continue
      const email = r.email?.trim()
      if (!email || !EMAIL_RE.test(email)) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      recipients.push(email)
    }

    const sentSet = alreadySent()
    const pending = recipients.filter((e) => !sentSet.has(e.toLowerCase()))

    const domains: Record<string, number> = {}
    for (const e of recipients) {
      const d = e.split('@')[1]?.toLowerCase() ?? '?'
      domains[d] = (domains[d] ?? 0) + 1
    }

    console.log('\n=== FEEDBACK CAMPAIGN — RECIPIENT COUNT (production) ===')
    console.log(`total users in DB:        ${total}`)
    console.log(`excluded (suspended):     ${suspended}`)
    console.log(`excluded (invalid/empty): ${invalid}`)
    console.log(`already sent (skipped):   ${recipients.length - pending.length}`)
    console.log(`-------------------------------------------------`)
    console.log(`WILL RECEIVE THIS RUN:    ${pending.length}`)
    console.log(`\ntop recipient domains:`)
    Object.entries(domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([d, c]) => console.log(`  ${d}: ${c}`))

    if (!CONFIRM) {
      console.log('\n[DRY-RUN] No emails sent. Re-run with --confirm to send to the count above.\n')
      return
    }

    console.log(`\n[CONFIRM] Sending to ${pending.length} recipients…\n`)
    const element = FeedbackEmail({ replyToEmail: REPLY_TO, siteUrl: SITE_URL })
    const [html, text] = await Promise.all([renderEmail(element), renderEmailText(element)])

    let ok = 0
    let fail = 0
    for (let i = 0; i < pending.length; i++) {
      const to = pending[i]
      const res = await sendEmail({ to, subject: SUBJECT, html, text, replyTo: REPLY_TO })
      if (res.ok) {
        ok++
        appendFileSync(SENT_LOG, `${to}\tok\t${res.id}\n`)
      } else {
        fail++
        const reason = 'error' in res ? res.error : 'unknown'
        appendFileSync(SENT_LOG, `${to}\tfail\t${reason}\n`)
        console.error(`  [${i + 1}/${pending.length}] FAIL ${to}: ${reason}`)
      }
      if ((i + 1) % 25 === 0) console.log(`  progress: ${i + 1}/${pending.length} (ok=${ok} fail=${fail})`)
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS))
    }

    console.log(`\n=== DONE — sent ok: ${ok}, failed: ${fail}. Log: ${SENT_LOG} ===\n`)
  } finally {
    await db.destroy()
  }
}

run().catch((e) => {
  console.error('[campaign] fatal:', e.message)
  process.exit(1)
})
