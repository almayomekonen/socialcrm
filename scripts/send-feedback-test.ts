import { renderEmail, renderEmailText } from '@/lib/email/render'
import { sendEmail } from '@/lib/email/sender'
import FeedbackEmail from '@/emails/templates/FeedbackEmail'
import { writeFileSync } from 'fs'

// Single recipient: CLI arg if given, else the operator's own inbox.
// Validated as one address — this script never fans out to multiple users.
const TEST_RECIPIENT = process.argv[2]?.trim() || 'alamayo274@gmail.com'
const SUBJECT = 'נשמח לשמוע את דעתך על SocialCRM 💙'
const SITE_URL = 'https://getsocialcrm.com'

// Replies always come back to the operator's working inbox.
const REPLY_TO = 'alamayo274@gmail.com'

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TEST_RECIPIENT)) {
  console.error(`[feedback-test] invalid recipient: "${TEST_RECIPIENT}"`)
  process.exit(1)
}

async function run() {
  const element = FeedbackEmail({ replyToEmail: REPLY_TO, siteUrl: SITE_URL })
  const [html, text] = await Promise.all([renderEmail(element), renderEmailText(element)])

  const previewPath = 'docs/superpowers/feedback-email-preview.html'
  writeFileSync(previewPath, html, 'utf8')
  console.log(`[feedback-test] preview written: ${previewPath} (${html.length} bytes)`)

  console.log(`[feedback-test] sending TEST to ${TEST_RECIPIENT} (reply-to ${REPLY_TO}) …`)
  const result = await sendEmail({ to: TEST_RECIPIENT, subject: SUBJECT, html, text, replyTo: REPLY_TO })

  if (result.ok) {
    console.log(`[feedback-test] SENT ok — message id: ${result.id}`)
  } else {
    console.error(`[feedback-test] FAILED — ${result.error}`)
    process.exit(1)
  }
}

run()
