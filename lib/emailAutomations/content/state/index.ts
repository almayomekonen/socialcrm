import type { ContentItem } from '../types'
import {
  inactiveOwnerCandidates,
  ownersMissingFacebook,
  ownersMissingWhatsapp,
  ownersTrialEnding,
  ownersWithFirstLead,
} from '../../recipients'
import { isInactiveOwner } from '../../conditions'

// The state-triggered lifecycle emails, migrated verbatim from the original
// per-email templates into content items. Keys are preserved so historical
// email_automation_sends rows and send-once continuity stay intact. These
// interrupt the educational journey (higher priority) but never advance it.

export const STATE_CONTENT: ContentItem[] = [
  {
    key: 'facebook_not_connected',
    category: 'lifecycle',
    topic: 'activation',
    schedule: { kind: 'condition' },
    priority: 'highest',
    greet: true,
    subject: 'הגיע הזמן לחבר את פייסבוק ולקבל לידים אוטומטית',
    preview: 'כל ליד חדש מהמודעות שלך נכנס אוטומטית למערכת',
    headline: 'אף ליד לא צריך יותר ליפול בין הכיסאות',
    blocks: [
      { type: 'paragraph', text: 'רוב הלקוחות שלך מתחילים במודעה בפייסבוק.' },
      {
        type: 'paragraph',
        text: 'כשפייסבוק מחובר, כל פנייה חדשה נכנסת ל SocialCRM ברגע שהיא מגיעה, עם כל הפרטים מסודרים במקום אחד. כך אפשר להגיב ראשון, בדיוק כשהלקוח הכי מתעניין.',
      },
      { type: 'paragraph', text: 'החיבור לוקח פחות מדקה, ומאותו רגע כל ליד חדש כבר מחכה במערכת.' },
    ],
    cta: { label: 'חיבור פייסבוק', route: '/settings/facebook' },
    audience: ownersMissingFacebook,
  },
  {
    key: 'whatsapp_not_connected',
    category: 'lifecycle',
    topic: 'activation',
    schedule: { kind: 'condition' },
    priority: 'high',
    greet: true,
    subject: 'הגיע הזמן לחבר את וואטסאפ ולרכז את כל השיחות',
    preview: 'כל שיחת וואטסאפ עם לקוח מסודרת במקום אחד',
    headline: 'כל שיחה עם לקוח, במקום אחד',
    blocks: [
      { type: 'paragraph', text: 'חלק גדול מהלקוחות שלך מעדיפים לכתוב בוואטסאפ.' },
      {
        type: 'paragraph',
        text: 'כשוואטסאפ מחובר, כל שיחה נכנסת ל SocialCRM לצד הליד שלה. כל ההיסטוריה במקום אחד, ברור מי מחכה לתשובה, ואף הודעה לא הולכת לאיבוד בין עשרות צ׳אטים פתוחים.',
      },
      { type: 'paragraph', text: 'דקה אחת של חיבור, ומעכשיו כל השיחות מרוכזות ומסודרות.' },
    ],
    cta: { label: 'חיבור וואטסאפ', route: '/settings/facebook?section=whatsapp' },
    audience: ownersMissingWhatsapp,
  },
  {
    key: 'first_lead_received',
    category: 'lifecycle',
    topic: 'small_win',
    schedule: { kind: 'condition' },
    priority: 'medium',
    greet: true,
    subject: 'הליד הראשון כבר במערכת',
    preview: 'הליד הראשון שלך כבר במערכת ומחכה לתשובה',
    headline: 'הליד הראשון שלך הגיע',
    blocks: [
      { type: 'paragraph', text: 'זה הרגע שבו כל העבודה מתחילה להשתלם.' },
      {
        type: 'paragraph',
        text: 'הליד הראשון כבר במערכת ומחכה. לקוחות זוכרים את מי שענה ראשון, וכל דקה של מהירות מגדילה את הסיכוי לסגור.',
      },
      { type: 'paragraph', text: 'אפשר להיכנס עכשיו, לראות את הפרטים, ולפנות ללקוח בזמן שהעניין עדיין חם.' },
    ],
    cta: { label: 'לצפייה בליד', route: '/leads' },
    audience: ownersWithFirstLead,
  },
  {
    key: 'no_activity',
    category: 'lifecycle',
    topic: 'activation',
    schedule: { kind: 'condition' },
    priority: 'low',
    greet: true,
    subject: 'הלידים שלך מחכים לך',
    preview: 'לידים חדשים ממשיכים להיכנס וממתינים למענה',
    headline: 'הלידים שלך ממשיכים להגיע',
    blocks: [
      { type: 'paragraph', text: 'עברו כמה ימים מאז הביקור האחרון במערכת.' },
      {
        type: 'paragraph',
        text: 'בזמן הזה לידים חדשים ממשיכים להיכנס ולחכות. כל יום שעובר בלי מענה הוא לקוח פוטנציאלי שעלול לבחור במישהו אחר.',
      },
      { type: 'paragraph', text: 'כמה דקות במערכת מספיקות כדי לחזור לשליטה ולראות בדיוק למי כדאי לפנות היום.' },
    ],
    cta: { label: 'חזרה למערכת', route: '/dashboard' },
    audience: inactiveOwnerCandidates,
    condition: isInactiveOwner,
  },
  {
    key: 'trial_ending',
    category: 'transactional',
    topic: 'activation',
    schedule: { kind: 'condition' },
    priority: 'high',
    greet: true,
    subject: 'תקופת הניסיון שלך מסתיימת בקרוב',
    preview: 'עוד כמה ימים והגישה ללידים שלך תיסגר',
    headline: 'תקופת הניסיון שלך עומדת להסתיים',
    blocks: [
      { type: 'paragraph', text: 'בימים האחרונים כל הלידים שלך נוהלו במקום אחד מסודר.' },
      {
        type: 'paragraph',
        text: 'עם סיום הניסיון תיסגר הגישה ללידים, למעקבים ולשיחות שכבר נבנו. שדרוג עכשיו שומר על הכל פעיל וממשיך לעבוד ללא הפרעה.',
      },
      { type: 'paragraph', text: 'כמה קליקים היום, וכל מה שנבנה נשאר זמין.' },
    ],
    cta: { label: 'לשדרוג המנוי', route: '/settings/update_payment' },
    audience: ownersTrialEnding,
  },
]
