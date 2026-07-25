import type { ContentItem } from '../types'

// Event-triggered content items — sent in response to a lifecycle event rather
// than a schedule or a state condition. The mapping to the Automation shape is
// the existing contentToAutomation `kind: 'event'` branch; dispatch goes through
// dispatchLifecycleEvent like any other event automation.
//
// These are transactional: no unsubscribe footer, exempt from suppression and
// from the 24h lifecycle cooldown (see dispatch.ts). They still consume the
// engine's per-user claim, so each one sends at most once per user, forever.

// Unicode bidi controls, built via char code so no invisible characters live in
// the source (keeps the file lint-/"Trojan-source"-safe and reviewable).
// RLE (U+202B) opens a right-to-left embedding; PDF (U+202C) closes it.
const RLE = String.fromCharCode(0x202b)
const PDF = String.fromCharCode(0x202c)

export const EVENT_CONTENT: ContentItem[] = [
  {
    // Sent on the FIRST successful subscription activation (Grow payment).
    // No `recurring` ⇒ periodKey '' ⇒ the (automationKey, userId, periodKey)
    // claim makes this send-once-forever: renewals re-fire the event but the
    // claim is already taken, so the dispatcher returns 'skipped'.
    key: 'subscription_activated',
    category: 'transactional',
    topic: 'welcome',
    schedule: { kind: 'event', event: 'subscription.activated' },
    priority: 'high',
    greet: true,
    subject: 'תודה שבחרת ב־SocialCRM 💙',
    preview: 'תודה שבחרת ב־SocialCRM',
    headline: 'תודה שבחרת ב־SocialCRM',
    blocks: [
      { type: 'paragraph', text: 'רצינו להגיד לך תודה רבה שבחרת להצטרף ל־SocialCRM.' },
      {
        type: 'paragraph',
        text: 'אנחנו מעריכים מאוד את האמון שנתת בנו, ומתרגשים ללוות אותך. המטרה שלנו היא לעזור לך לנהל את הלידים והלקוחות שלך בצורה פשוטה, מסודרת ויעילה יותר.',
      },
      { type: 'paragraph', text: 'אם תהיה לך כל שאלה, רעיון או צורך בעזרה – אנחנו כאן בשבילך ונשמח לעזור בכל שלב.' },
      { type: 'paragraph', text: 'מאחלים לך המון הצלחה,' },
      { type: 'paragraph', text: 'צוות SocialCRM 💙' },
    ],
    cta: { label: 'כניסה למערכת', route: '/dashboard' },
  },
  {
    // Sent the moment the NEVER_STARTED → TRIAL_ACTIVE transition first succeeds
    // (actions/trial.ts, on started === true). Like subscription_activated: no
    // `recurring` ⇒ periodKey '' ⇒ the (automationKey, userId, '') claim makes it
    // send-once-forever, so refreshes / double-clicks / concurrent activations
    // that re-fire the event hit an already-taken claim and return 'skipped'.
    key: 'trial_started',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'event', event: 'trial.started' },
    priority: 'high',
    greet: true,
    subject: 'ה־SocialCRM Pro שלך פעיל 🚀',
    preview: '7 ימי ה־Pro שלך התחילו — כל המערכת פתוחה עבורך',
    headline: 'ברוך הבא ל־SocialCRM Pro',
    blocks: [
      { type: 'paragraph', text: '7 ימי ה־Pro שלך התחילו עכשיו, וכל המערכת פתוחה עבורך.' },
      { type: 'paragraph', text: 'במהלך תקופת הניסיון יש לך גישה מלאה לכל יכולות ה־Pro, כולל:' },
      { type: 'paragraph', text: '• ניהול כל הלידים והשיחות במקום אחד' },
      { type: 'paragraph', text: '• כלי ה־AI המתקדמים של SocialCRM' },
      { type: 'paragraph', text: '• וואטסאפ, משימות, יומן וקבצים' },
      { type: 'paragraph', text: '• כל יכולות ה־Pro ללא הגבלה של מסלול בסיסי' },
      {
        type: 'paragraph',
        text: 'המטרה שלנו פשוטה: לתת לך 7 ימים לעבוד עם SocialCRM באמת ולהרגיש איך העסק שלך נראה כשהכול נמצא במקום אחד.',
      },
      { type: 'divider' },
      { type: 'paragraph', text: 'אין צורך בכרטיס אשראי. בסיום 7 הימים תוכל לבחור אם להמשיך עם Pro.' },
    ],
    // RTL bidi fix, scoped to THIS label only. This is the one CTA that mixes
    // Hebrew with a Latin brand ("SocialCRM"); the shared email Button carries no
    // `dir` attribute (react-email wraps the label in MSO spans) and email clients
    // don't reliably inherit <html dir="rtl">, so a mixed label falls back to an
    // LTR base and renders "SocialCRM" on the wrong side. Wrapping the label in an
    // RTL embedding (RLE … PDF) carries the direction in the text itself, which the
    // text engine honors in every client, so it displays naturally as
    // "כניסה ל־SocialCRM". The right-aligned, inline-block button container and the
    // shared ContentEmail button are untouched (every other CTA is pure Hebrew, so
    // this change affects no other email).
    cta: { label: `${RLE}כניסה ל־SocialCRM${PDF}`, route: '/dashboard' },
  },
]
