import type { ContentItem } from '../types'

// Event-triggered content items — sent in response to a lifecycle event rather
// than a schedule or a state condition. The mapping to the Automation shape is
// the existing contentToAutomation `kind: 'event'` branch; dispatch goes through
// dispatchLifecycleEvent like any other event automation.
//
// These are transactional: no unsubscribe footer, exempt from suppression and
// from the 24h lifecycle cooldown (see dispatch.ts). They still consume the
// engine's per-user claim, so each one sends at most once per user, forever.

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
    cta: { label: 'כניסה ל־SocialCRM', route: '/dashboard' },
  },
]
