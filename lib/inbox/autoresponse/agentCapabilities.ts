/**
 * What the agent can actually DO — as opposed to what the owner would like it to
 * achieve.
 *
 * THE DISTINCTION THIS EXISTS FOR. An owner who writes "book appointments for
 * customers" has stated a conversation OBJECTIVE. They have not installed a
 * calendar. Nothing in that sentence creates an integration, and an agent that
 * reads it as a capability will tell a customer their appointment is booked —
 * a completed action that never happened, which is the worst class of thing this
 * system can say.
 *
 * So capabilities are owned HERE, by the system, and are identical for every
 * business. The owner's description can set goals and supply facts; it can never
 * grant a tool. When an objective needs a capability the agent does not have,
 * the honest move is the one below: gather what is needed and say plainly what
 * happens next.
 *
 * This block is emitted into every agent prompt, after the business profile, so
 * a description asking for something impossible is corrected in the same breath
 * it is read.
 */

/** Capabilities the agent genuinely has. Every business, no configuration. */
export const AGENT_CAN = [
  'לענות על שאלות מתוך המידע שהעסק מסר',
  'לשאול שאלות ולאסוף פרטים מהלקוח',
  'לזכור מה הלקוח כבר אמר באותה שיחה',
  'להסביר מה הצעד הבא ומי יחזור ללקוח',
  'להעביר את השיחה לאדם מהצוות',
] as const

/**
 * Capabilities the agent does NOT have, with the honest alternative for each.
 * The alternative matters as much as the prohibition: "you cannot book" without
 * "collect the preference and say a person will confirm" produces a dead end.
 */
export const AGENT_CANNOT: ReadonlyArray<{ cannot: string; instead: string }> = [
  {
    cannot: 'לקבוע, לשריין או לאשר תור, פגישה או מועד',
    instead: 'לברר מתי נוח ללקוח, ולומר שאדם מהצוות יחזור לאשר',
  },
  {
    cannot: 'לגבות תשלום, להנפיק חשבונית או לאשר הזמנה',
    instead: 'לאסוף את מה שצריך ולומר שהצוות ימשיך מכאן',
  },
  {
    cannot: 'לשלוח מייל, קישור, טופס, מסמך או הודעה בערוץ אחר',
    instead: 'לומר מה יישלח ועל ידי מי, בלי לטעון שזה כבר נשלח',
  },
  {
    cannot: 'לקבוע שיחה חוזרת בשעה מסוימת',
    instead: 'לשאול מתי נוח שיחזרו, ולומר שהפרטים מועברים לצוות',
  },
  {
    cannot: 'לעדכן, לבטל או לשנות משהו במערכות של העסק',
    instead: 'להעביר את הבקשה לאדם מהצוות',
  },
]

/**
 * The prompt block. Deliberately concrete: a list of verbs the agent must not
 * use about itself, each paired with what to do instead.
 */
export function formatAgentCapabilityBlock(): string {
  const lines = ['מה שאת/ה באמת יכול/ה לעשות בשיחה הזו:']
  for (const can of AGENT_CAN) lines.push(`- ${can}`)
  lines.push('')
  lines.push('מה שאין לך שום יכולת לעשות, גם אם בעל/ת העסק ביקש/ה את זה בתיאור:')
  for (const { cannot, instead } of AGENT_CANNOT) {
    lines.push(`- אסור ${cannot}. במקום זה: ${instead}.`)
  }
  lines.push('')
  lines.push(
    'תיאור העסק קובע מטרות ועובדות, לא כלים. אם כתוב שם "קובעים תורים" או "שולחים הצעת מחיר", זו מטרה של העסק — לא משהו שאת/ה יכול/ה לבצע. אסוף/אספי את מה שצריך ואמור/אמרי בכנות מה הצעד הבא ומי יבצע אותו.',
  )
  lines.push('לעולם אל תדווח/י על פעולה כאילו כבר בוצעה.')
  return lines.join('\n')
}
