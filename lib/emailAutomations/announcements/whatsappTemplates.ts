import { isSuppressed } from '@/db/emailSuppressions'
import { claimSend, markSent } from '@/db/emailAutomationSends'
import { sendEmail } from '@/lib/email/sender'
import { renderEmail, renderEmailText } from '@/lib/email/render'
import { getEmailFrom } from '@/lib/email/config'
import { lifecycleOwners } from '../recipients'
import { renderContentItem } from '../contentToAutomation'
import { appUrl } from '../config'
import type { ContentItem } from '../content/types'
import type { Recipient } from '../types'

/**
 * ONE-TIME isolated product announcement: WhatsApp ready-made messages.
 *
 * Deliberately NOT registered in the lifecycle scheduler (STATE_CONTENT/AUTOMATIONS),
 * so it never enters `cooldownKeys()` and therefore CANNOT affect the 24h lifecycle
 * cooldown, priority, or the existing drip. It reuses the existing production
 * primitives only — ContentEmail (branded layout), sendEmail (Resend), the owner
 * recipient query, suppression, production unsubscribe signing, and the
 * email_automation_sends claim (for send-once idempotency under this dedicated key).
 * Approved copy is verbatim; the branded template's required headline reuses the
 * feature name from the approved subject.
 */

export const ANNOUNCEMENT_KEY = 'whatsapp_templates_announcement'

export const WHATSAPP_TEMPLATES_ANNOUNCEMENT: ContentItem = {
  key: ANNOUNCEMENT_KEY,
  category: 'lifecycle', // → unsubscribe footer included, signed with the prod secret at render time
  topic: 'new_feature',
  schedule: { kind: 'condition' },
  priority: 'highest',
  greet: false,
  subject: 'הודעות מוכנות בוואטסאפ עכשיו ב־SocialCRM',
  preview: 'יוצרים הודעה פעם אחת ושולחים אותה ללידים ישירות מהמערכת.',
  headline: 'הודעות מוכנות בוואטסאפ',
  blocks: [
    { type: 'paragraph', text: 'שלום,' },
    { type: 'paragraph', text: 'אנחנו שמחים לשחרר לכם פיצ׳ר חדש ב־SocialCRM: הודעות מוכנות בוואטסאפ 💬' },
    {
      type: 'paragraph',
      text: 'מעכשיו תוכלו ליצור הודעות שאתם שולחים שוב ושוב ללידים, לפנייה ראשונה, פולואפ, תזכורת, עדכון או הצעה, ולשלוח אותן ישירות מכרטיס הליד.',
    },
    { type: 'paragraph', text: 'אפשר לשלב שם ליד ושם עסק, ו־SocialCRM תכניס את הפרטים המתאימים אוטומטית בכל שליחה.' },
    { type: 'feature', title: 'איך מתחילים?', text: 'הגדרות → ערוצי לידים → הודעות מוכנות' },
    {
      type: 'paragraph',
      text: 'יוצרים הודעה, WhatsApp מאשרת אותה, וברגע שהיא מוכנה תוכלו להתחיל לשלוח אותה ללידים שלכם.',
    },
    { type: 'paragraph', text: 'עוד צעד בדרך להפוך את SocialCRM למקום אחד שממנו מנהלים את הלידים וגם את התקשורת איתם.' },
    { type: 'paragraph', text: 'בהצלחה, צוות SocialCRM' },
  ],
  cta: { label: 'ליצירת הודעה מוכנה', route: '/settings/facebook?section=templates' },
}

const APPROVED = {
  sender: 'SocialCRM <hello@getsocialcrm.com>',
  subject: WHATSAPP_TEMPLATES_ANNOUNCEMENT.subject,
  preheader: WHATSAPP_TEMPLATES_ANNOUNCEMENT.preview,
  ctaUrl: 'https://getsocialcrm.com/settings/facebook?section=templates',
  count: 38,
} as const

export type AnnouncementSendResult = {
  ok: boolean
  aborted?: string
  eligible: number
  attempted: number
  accepted: number
  failed: number
  skipped: number
  suppressedExcluded: number
  duplicatesPrevented: number
  sender: string
  subject: string
  ctaUrl: string
  failures: number[]
}

/** Owners (1 ADMIN/agency) minus suppressed, deduped by email. */
async function resolveAudience() {
  const owners = await lifecycleOwners()
  const eligible: Recipient[] = []
  const seen = new Set<string>()
  let suppressedExcluded = 0
  let duplicatesPrevented = 0
  for (const o of owners) {
    if (await isSuppressed(o.userId)) {
      suppressedExcluded++
      continue
    }
    const email = (o.email ?? '').toLowerCase().trim()
    if (!email) continue
    if (seen.has(email)) {
      duplicatesPrevented++
      continue
    }
    seen.add(email)
    eligible.push(o)
  }
  return { eligible, suppressedExcluded, duplicatesPrevented, ownersTotal: owners.length }
}

/**
 * Assert-then-send. All final safety checks run here (in production) before the
 * first email. On any mismatch it sends ZERO and returns `aborted`. On success it
 * sends idempotently: each recipient is claimed first (send-once); a send failure
 * keeps the claim so a re-run neither duplicates nor auto-retries an ambiguous send.
 */
export async function runWhatsappTemplatesAnnouncement(): Promise<AnnouncementSendResult> {
  const item = WHATSAPP_TEMPLATES_ANNOUNCEMENT
  const sender = getEmailFrom()
  const ctaUrl = appUrl(item.cta.route)
  const { eligible, suppressedExcluded, duplicatesPrevented } = await resolveAudience()

  const base: AnnouncementSendResult = {
    ok: false,
    eligible: eligible.length,
    attempted: 0,
    accepted: 0,
    failed: 0,
    skipped: 0,
    suppressedExcluded,
    duplicatesPrevented,
    sender,
    subject: item.subject,
    ctaUrl,
    failures: [],
  }

  // Final programmatic safety checks — send zero on any mismatch.
  const sampleHtml = await renderEmail(
    renderContentItem(item, eligible[0] ?? ({ userId: 0, agencyId: 0, email: 'x@x' } as Recipient)),
  )
  const problems: string[] = []
  if (eligible.length !== APPROVED.count) problems.push(`audience=${eligible.length} (expected ${APPROVED.count})`)
  if (sender !== APPROVED.sender) problems.push(`sender=${sender}`)
  if (item.subject !== APPROVED.subject) problems.push('subject-mismatch')
  if (item.preview !== APPROVED.preheader) problems.push('preheader-mismatch')
  if (ctaUrl !== APPROVED.ctaUrl) problems.push(`cta=${ctaUrl}`)
  if (/[—–]/.test(sampleHtml)) problems.push('dash-present')
  if (!/email\/unsubscribe/.test(sampleHtml)) problems.push('unsubscribe-missing')
  if (problems.length > 0) return { ...base, ok: false, aborted: problems.join('; ') }

  let accepted = 0
  let failed = 0
  let skipped = 0
  const failures: number[] = []
  for (const r of eligible) {
    // Send-once: claim before send. `false` ⇒ already claimed in a prior run ⇒ skip.
    const claimed = await claimSend({ automationKey: ANNOUNCEMENT_KEY, userId: r.userId, agencyId: r.agencyId, periodKey: '' })
    if (!claimed) {
      skipped++
      continue
    }
    const el = renderContentItem(item, r)
    const [html, text] = await Promise.all([renderEmail(el), renderEmailText(el)])
    const res = await sendEmail({ to: r.email, subject: item.subject, html, text })
    if ('error' in res) {
      // Keep the claim: no duplicate on re-run, no auto-retry of an ambiguous send.
      failed++
      failures.push(r.userId)
    } else {
      await markSent(ANNOUNCEMENT_KEY, r.userId, '')
      accepted++
    }
  }

  return { ...base, ok: true, attempted: accepted + failed, accepted, failed, skipped, failures }
}
