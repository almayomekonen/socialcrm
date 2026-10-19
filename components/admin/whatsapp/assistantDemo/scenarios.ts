/**
 * Scripted conversations for the SocialCRM AI WhatsApp demonstration
 * (app/admin/whatsapp/assistant-demo). PURE DATA, entirely fictional: no lead,
 * date or result here comes from any CRM, and nothing here is ever sent.
 *
 * `availability` says honestly what exists today:
 *   pilot  — the read-only assistant is built for this kind of question (agency
 *            103, behind WA_ASSISTANT_AGENCY_IDS) but is NOT live yet, and its
 *            answers have not been verified against a real model or Meta;
 *   future — the meeting workflow (Phase 2). Not built: no availability check,
 *            no Google sync from WhatsApp, no confirmation flow on WhatsApp.
 */

export type DemoStep =
  | { kind: 'owner'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'progress'; label: string; ms: number }
  | { kind: 'confirm'; meeting: DemoMeeting }
  | { kind: 'success'; meeting: DemoMeeting }
  | { kind: 'error'; title: string; text: string }

export type DemoMeeting = { lead: string; date: string; time: string; duration: string; type: string; calendar: string }

export type DemoScenario = {
  id: string
  title: string
  availability: 'pilot' | 'future'
  steps: DemoStep[]
  /** Steps played after the owner confirms, and after they cancel. */
  onConfirm?: DemoStep[]
  onCancel?: DemoStep[]
}

const MEETING: DemoMeeting = {
  lead: 'דניאל לוי (הדמיה)',
  date: 'יום שלישי, 27.10',
  time: '10:00',
  duration: '45 דקות',
  type: 'פגישת היכרות בזום',
  calendar: 'יומן Google של הנציג',
}

export const SCENARIOS: DemoScenario[] = [
  {
    id: 'day',
    title: 'סיכום יום',
    availability: 'pilot',
    steps: [
      { kind: 'owner', text: 'סכם לי את היום' },
      { kind: 'progress', label: 'בודק את המצב היום', ms: 1200 },
      {
        kind: 'assistant',
        text: '*היום יש 3 לידים שמחכים לך*\n\n• דניאל לוי כתב לפני שעתיים ועדיין לא קיבל מענה\n• 2 מעקבים מתוכננים להיום\n• ליד חדש אחד הגיע מפייסבוק הבוקר\n\nלפרטים המלאים: getsocialcrm.com/agent',
      },
    ],
  },
  {
    id: 'unanswered',
    title: 'מי לא קיבל מענה',
    availability: 'pilot',
    steps: [
      { kind: 'owner', text: 'מי לא קיבל מענה?' },
      { kind: 'progress', label: 'בודק שיחות פתוחות', ms: 1100 },
      { kind: 'assistant', text: '*2 לידים מחכים למענה*\n\n• דניאל לוי, מחכה שעתיים\n• מיכל כהן, מחכה 5 שעות\n\nלפרטים המלאים: getsocialcrm.com/agent' },
    ],
  },
  {
    id: 'lead',
    title: 'סטטוס ליד',
    availability: 'pilot',
    steps: [
      { kind: 'owner', text: 'מה הסטטוס של הליד דניאל?' },
      { kind: 'progress', label: 'מאתר ליד', ms: 1000 },
      { kind: 'assistant', text: '*דניאל לוי: בטיפול*\n\n• שאל על מחיר ביום ראשון\n• הנציג האחרון שענה: את/ה, לפני יומיים\n• אין מעקב מתוכנן\n\nלפרטים המלאים: getsocialcrm.com/agent' },
    ],
  },
  {
    id: 'meeting',
    title: 'קביעת פגישה',
    availability: 'future',
    steps: [
      { kind: 'owner', text: 'קבע לי פגישה עם הליד דניאל' },
      { kind: 'progress', label: 'מאתר ליד', ms: 900 },
      { kind: 'assistant', text: 'מצאתי את דניאל לוי. לאיזה יום ושעה לקבוע?' },
      { kind: 'owner', text: 'יום שלישי ב-10' },
      { kind: 'progress', label: 'בודק זמינות', ms: 1400 },
      { kind: 'confirm', meeting: MEETING },
    ],
    onConfirm: [
      { kind: 'progress', label: 'יוצר פגישה', ms: 1300 },
      { kind: 'success', meeting: MEETING },
    ],
    onCancel: [{ kind: 'assistant', text: 'בסדר, לא נקבעה פגישה.' }],
  },
  {
    id: 'conflict',
    title: 'התנגשות ביומן',
    availability: 'future',
    steps: [
      { kind: 'owner', text: 'קבע פגישה עם מיכל מחר ב-14:00' },
      { kind: 'progress', label: 'מאתר ליד', ms: 900 },
      { kind: 'progress', label: 'בודק זמינות', ms: 1300 },
      { kind: 'error', title: 'השעה תפוסה', text: 'ביומן כבר יש פגישה מחר ב-14:00. השעות הפנויות הקרובות: 15:00 או 16:30.' },
    ],
  },
]
