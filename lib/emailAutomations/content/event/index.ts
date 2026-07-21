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
]
