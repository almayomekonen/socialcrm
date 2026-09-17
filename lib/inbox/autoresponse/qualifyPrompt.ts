import type { ConversationCognition, Qualification, SalesStrategy } from './qualification'
import { isProductQuestion } from './salesIntent'
import { isBusinessIdentityQuestion } from './businessIdentityIntent'
import { fenceReminder, fenceTranscript } from './promptFence'
import type { ResponseProfile } from './responseProfile'

export type RegenerationReason = 'shape_validation' | 'safety_validation'

export const QUALIFY_SYSTEM_PROMPT = [
  'את/ה נציג/ה של עסק, שעונה ללקוחות בוואטסאפ. כתוב/כתבי כמו הודעת וואטסאפ קצרה של אדם אמיתי — לא בוט, לא מוקד, לא שאלון.',
  'העסק שאת/ה מייצג/ת, מה הוא עושה, ומה מותר לומר בשמו — מגיעים אך ורק מבלוק זהות העסק שמצורף להודעה. אין לך שום ידע מוקדם על העסק הזה, על התחום שלו, או על מה שהוא מציע.',
  'אל תניח/י תחום עיסוק. עסק יכול להיות קליניקה, מוסך, מספרה, חנות, משרד, ספק תוכנה, או כל דבר אחר. אם התחום לא כתוב בזהות העסק — הוא לא ידוע לך.',
  'שאלת העל: מה הלקוח מנסה להשיג עכשיו, ומה התגובה הכי שימושית.',
  'את/ה מנהל/ת שיחה, לא שאלון.',
  'אפשר לענות, להסביר, להכיר, להבהיר, לשאול, להמליץ, לקדם, להעביר לאדם, או לסגור. לא כל הודעה חייבת שאלה.',
  'אל תנסה/י להשלים את השדות החסרים בזה אחר זה.',
  'העובדות שנאספו הן זיכרון פנימי בלבד, לא רשימת משימות.',
  'שדות מובנים הם זיכרון פנימי, לא רשימת שאלות שמכתיבה את השאלה הבאה.',
  'שם הוא אופציונלי בשיחה. אל תתעדף/י אותו על פני צורך מפורש.',
  'אם הלקוח שאל שאלה — ענה/י עליה קודם, ורק אחר כך שקול/י שאלה אחת משלך.',
  'אם הלקוח אמר כן אחרי הצעה להסביר, או ביקש הסבר — הסבר/י מהעובדות המאומתות של העסק. אפס שאלות זה תקין. אסור לשאול שאלת בירור במקום ההסבר.',
  'בכל הודעה הסתכל/י קודם על מה שהלקוח אמר עכשיו, על ההקשר של השיחה, ועל הצעד שהכי שימושי עכשיו.',
  'היעד הבא הוא החלטה על מה הכי שווה להבין עכשיו — לא השדה שחסר.',
  'אם הלקוח כבר מסר צורך, קושי או תוצאה רצויה — אל תשאל/י על זה שוב. אפשר לדלג קדימה או להסביר מה העסק יכול לעשות בשביל זה.',
  'אל תשאל/י על urgency/budget/location/callback רק משום שהם חסרים.',
  'לקוח יכול לנהל כמה תורות טבעיים בלי לאסוף שדה מובנה חדש.',
  '- העדיף/י שפה שיחתית טבעית על מונחי מכירה.',
  '- בטקסט ללקוח אל תשתמש במקף או בקו מפריד. פסיק או נקודה במקום.',
  '- הגיב/י לניסוח של הלקוח. אל תתרגם/י אותו למונחים מקצועיים שהוא לא השתמש בהם.',
  '- אל תשבח/י כל הודעה. אל תייצר/י התלהבות שלא קיימת אצל הלקוח.',
  '- אל תחזור/חזרי על דברי הלקוח כסיכום. אל תפתח/י ב"מבין שזה" או "זה מלחיץ" אם זה לא מוסיף מידע.',
  '- אל תשאל/י שאלה רק כי שדה חסר.',
  '- ענה/י למה שהלקוח כתב עכשיו. כל הודעה צריכה לקדם או לתת מידע שימושי.',
  '- בשאלת בירור: לכל היותר סימן שאלה אחד, 1–2 משפטים.',
  '- בשאלה על מה שהעסק מציע: קודם תשובה ישירה, ורק מעובדות מאומתות שסופקו בזהות העסק. אסור להמציא שירות או יכולת. אחרי התשובה אפשר שאלת המשך אחת. אסור לשאול שאלת בירור לפני התשובה.',
  '- בשאלת זהות העסק (במה אתם עוסקים / מה אתם מציעים / הגעתי מהפרסום): ענה/י ישירות מזהות העסק. אל תשאל/י מאיפה הלקוח הגיע ואל תבקש/י צילום מסך או קישור.',
  '- לעולם אל תשאל/י את הלקוח להסביר מה העסק הזה עושה. בירור הוא רק על הלקוח.',
  '- אם הלקוח ביקש הסבר או אישר הצעה להסביר: הסבר/י בלי שאלת בירור. אפס שאלות זה תקין.',
  '- בהתאמה לצורך: הסבר/י בקצרה מה העסק עושה בשביל הצורך שנאמר, ואז ערך רלוונטי. אל תצרף/י שאלת בירור רק כי אפשר לשאול. שאלה רק אם היא צעד טבעי אחרי שהערך ברור.',
  '- בתודה/אוקיי קצרים: סגירה קצרה או המתנה. אל תגיד/י שמישהו מהצוות יחזור רק בגלל תודה.',
  '- תיאור צורך אינו סיבה להעביר לאדם.',
  '- אל תגיד/י "אני מעביר/ה אותך לנציג" או "לאנשי הצוות" רק כי הלקוח תיאר צורך.',
  '- אל תחשוף/חשפי מושגים פנימיים: הסמכה, העברה, workflow, qualification, salesMove, extracted, cognition.',
  '- אל תשתמש/י במילוי גנרי: נעים להכיר, איזה כיף, מעולה, אני כאן כדי לעזור, ספר/י לי קצת על העסק שלך, כדי שנוכל להבין איך אפשר לעזור.',
  '- ברכת פתיחה נקבעת מחוץ למודל. אם צורפה הוראת ברכה — פתח/י בה בדיוק כפי שנמסרה, ואז המשך/המשיכי לתוכן. אם לא צורפה — אל תפתח/י בברכה ואל תפתח/י בשם.',
  '- אל תשאל/י על משהו שהלקוח כבר ענה, ואל תחזור/חזרי על אותה שאלה.',
  '- אם הלקוח תיקן פרט שמסר קודם — התיקון האחרון הוא הנכון. השתמש/י בו, ואל תתייחס/י לערך הישן.',
  '- extracted: מלא/י רק ממה שנאמר במפורש. אין חובה למלא שדה בכל תור. need ברגע שתואר צורך — ואז אל תשאל/י שוב מה הצורך.',
  '- hotSignal=true רק בכוונת קנייה חזקה או בקשה מפורשת לאדם (מחיר/פגישה/להתחיל/לדבר עם נציג). תיאור צורך אינו hotSignal. hotSignal הוא תיוג פנימי בלבד — אל תעביר/י לאדם ואל תכתוב/כתבי שמישהו מהצוות יחזור רק בגלל כוונת קנייה. העברה לאדם רק אם הלקוח ביקש במפורש נציג.',
  '- uncertain=true רק כשאי אפשר להמשיך בלי להמציא עובדה על העסק, או שהלקוח ביקש אדם. תיאור צורך אינו uncertain.',
  '- מותר לדבר על מועדים, שעות, תורים ומחירים כשהמידע מופיע בזהות העסק — צטט/י אותו כלשונו. כשהוא לא מופיע שם: אמור/אמרי בכנות שאין לך את הפרט הזה והצע/י שאדם מהצוות יחזור ללקוח.',
  '- אסור להתחייב בשם העסק: לא לקבוע תור, לא לאשר מועד, לא להבטיח מחיר או תוצאה, ולא לדווח על פעולה שכבר בוצעה. אסור להמציא שירות, מדיניות או תהליך הצטרפות שלא מופיע בזהות העסק.',
  '- Answer in the customer\'s current language. If the inbound contains Hebrew, answer in Hebrew. If the inbound is English-only, answer in English.',
  '- Use first person singular. Keep the response natural for WhatsApp.',
  '- MIRROR, DON\'T MIMIC: match the customer\'s register. Do not copy slang the customer has not used. Do not invent familiarity.',
  '- Reuse a vocative only when the customer actually used it and ResponseProfile provides it.',
  '- Never raise emotional energy above the customer. Never fake enthusiasm or emotion.',
  '- At most one emoji. Use an emoji only when the customer is casual and has used an emoji or clearly established casual slang.',
  '- Professional customers should receive professional language. Casual customers may receive relaxed language.',
  '- Frustrated customers get one short recognition clause, then continue the existing sales task. No therapy, long empathy, apologies, or closing because of emotion.',
  '- Confused customers get a clear direct explanation, then continue the existing sales task.',
  '- Urgency affects brevity and directness, not business policy.',
  '- ResponseProfile changes delivery only. It never changes facts, sales strategy, eligibility, or whether a response is allowed.',
].join('\n')

const REGEN_CONSTRAINT: Record<RegenerationReason, string> = {
  shape_validation:
    'חשוב מאוד: תשובה קצרה, עד שלושה משפטים. לכל היותר סימן שאלה אחד. בשאלה על מה שהעסק מציע או בהסבר אפשר בלי שאלה. בלי סיכום שיחה ובלי "אני מעביר אותך".',
  safety_validation:
    'חשוב מאוד: אל תתחייב/י בשם העסק — אל תקבע/י תור, אל תאשר/י מועד, אל תבטיח/י מחיר או תוצאה, ואל תדווח/י על פעולה שכבר בוצעה. פרט שלא מופיע בזהות העסק אינו קיים: אמור/אמרי בכנות שאין לך אותו והצע/י שאדם מהצוות יחזור. לכל היותר שאלת המשך אחת.',
}

/** Last inbound looks like a stated need or problem — not a greeting or a name. */
export function inboundStatesBusinessNeed(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /עזרה|צריכ[הא]|צריך|בעיה|כאב|מפריע|מחפש|מחפשת|מעוניין|מעוניינת|\bneed\b|\bhelp (me|with)\b|\bstruggling\b|\blooking for\b/i.test(
    t,
  )
}

/** Operational difficulty — forgetting, losing track, overwhelm. Not the business need itself. */
export function inboundStatesPain(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /מפריע|שוכח|שוכחת|מפספס|מפספסת|לאיבוד|עמוס|נשכח|לא חוזר|קשה ל|\bforget|\boverwhelm|\blosing track|\bmiss(?:ed)? follow/i.test(
    t,
  )
}

/** Business consequence of the pain — lost customers, churn, going elsewhere. */
export function inboundStatesImpact(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /למישה[וויה]|לקוח[הא]? אחר|מפסיד|מפספסת לקוח|הפסד|עוזב|אבד לקוח|עולה לי|בכסף|הכנסות|lost (?:a )?customer|goes? elsewhere|lose (?:them|business|clients|money)|costs? me/i.test(
    t,
  )
}

/** How they handle it today — spreadsheet, WhatsApp, in their head. */
export function inboundStatesWorkflow(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /באקסל|בוואטסאפ|בראש|היום אני|\bspreadsheet|\bexcel\b|\bwhatsapp\b|in my head|currently (?:use|manage)/i.test(t)
}

/** Stated desired change — not just the current problem. */
export function inboundStatesOutcome(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /רוצה ש|שיהיה אחרת|הייתי רוצה|שזה יעבוד|want (?:it )?to|would (?:like|want)|instead/i.test(t)
}

function formatCognitionMemory(
  cognition: ConversationCognition | undefined,
  mode: 'discover' | 'product' = 'discover',
): string {
  const c = cognition ?? {}
  const fact = (v: string | undefined) => (v && v.trim() ? v.trim() : '(לא ידוע)')
  const next =
    mode === 'product'
      ? 'היעד עכשיו הוא להסביר, מעובדות העסק, מה העסק עושה בשביל הצורך שכבר נאמר — לא לבחור את שאלת הבירור הבאה.'
      : 'בחר/י יעד אחד עם הערך הכי גבוה עכשיו, לפי מה שהלקוח כתב ומה שהעסק צריך לדעת כדי לעזור לו. אל תעבור/עברי סדר קבוע ואל תשאל/י על מה שכבר נאמר.'
  return [
    'כבר מובן (זיכרון פנימי, לא רשימת שדות להשלים):',
    `pain=${fact(c.pain)}`,
    `impact=${fact(c.impact)}`,
    `workflow=${fact(c.currentWorkflow)}`,
    `outcome=${fact(c.desiredOutcome)}`,
    `יעד קודם: ${c.lastObjective ?? '(אין)'}`,
    `אסטרטגיה: ${c.salesStrategy ?? '(אין)'}`,
    next,
  ].join('\n')
}

export function formatDeliveryBlock(profile: ResponseProfile): string {
  const vocative = profile.vocative ?? 'none'
  const lines = [
    'Delivery profile:',
    `language=${profile.language}`,
    `tone=${profile.tone}`,
    `establishedTone=${profile.establishedTone}`,
    `emotion=${profile.emotion}`,
    `urgency=${profile.urgency}`,
    `style=${profile.customerStyle}`,
    `vocative=${vocative}`,
    'Delivery is style only.',
    'Do not change facts or conversation policy.',
    'Mirror the register without mimicking.',
  ]
  if (vocative === 'none') {
    lines.push('Do not invent a vocative.')
  }
  if (profile.emotion === 'frustrated') {
    lines.push('One short recognition clause, then continue the existing sales task.')
  }
  if (profile.urgency === 'high') {
    lines.push('Urgency is delivery only: be brief and direct. Do not change business policy.')
  }
  return lines.join('\n')
}

export function buildQualifyUser(args: {
  transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  qualification: Qualification
  collectFields: { required: string[]; optional: string[] }
  guidance: string | null
  focusField?: string | null
  runtimeCognition?: string | null
  regenerationReason?: RegenerationReason
  salesMove?: string | null
  salesStrategy?: SalesStrategy | null
  productKnowledgeBlock?: string | null
  businessIdentityBlock?: string | null
  discoveryBudgetExhausted?: boolean
  responseProfile?: ResponseProfile | null
  /**
   * Verbatim opening line, decided deterministically outside the model (see
   * greeting.ts). Null on every turn that must not open with a greeting.
   */
  greetingLine?: string | null
  /**
   * Rolling summary of everything older than the verbatim window
   * (conversationSummary.ts). Null when the conversation still fits.
   */
  summaryBlock?: string | null
  /**
   * The customer's message is a direct ANSWER to the question we just asked, and
   * a next step is already on the table.
   *
   * Real conversation: the agent offered to pass the request to the team and
   * asked for a name and business. The customer replied "קרן מקונן / עסק
   * למספרת כלבים" — and the agent re-explained the product and asked for the
   * same permission a second time. Sticky PRODUCT_FIT strategy had carried a
   * pitch objective across the answer, so the answer was treated as another
   * chance to sell rather than as the thing that unblocks the next step.
   */
  answeringOurRequest?: boolean
  /** We have already offered to bring in a person; do not ask that again. */
  handoffAlreadyOffered?: boolean
}): string {
  // collectFields / focusField / runtimeCognition stay on the signature for
  // call-site compatibility. They must not appear as "ask this field next".
  void args.collectFields
  void args.focusField
  void args.runtimeCognition
  const have = Object.entries(args.qualification)
    .filter(([k, v]) => k !== 'cognition' && typeof v === 'string' && v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const lastInbound = [...args.transcript].reverse().find((m) => m.direction === 'inbound')?.text ?? ''
  const needKnown = Boolean(args.qualification.need) || inboundStatesBusinessNeed(lastInbound)
  /**
   * Product mode tells the model to answer FROM product facts — which is right
   * when the customer asked about the product, and wrong when they just answered
   * a question we asked.
   *
   * The sticky PRODUCT_FIT strategy carries across turns, so "קרן מקונן / עסק
   * למספרת כלבים" — a direct answer to "what is your name and business?" —
   * arrived in product mode and drew the product description for the second
   * time. An answer is not a request for a pitch. Unless THIS message is itself
   * a product question, an answering turn leaves product mode.
   */
  const productMode =
    (args.salesMove === 'PRODUCT_QUESTION' ||
      args.salesMove === 'PRODUCT_FIT' ||
      args.salesMove === 'BUYING_SIGNAL') &&
    !(args.answeringOurRequest && !isProductQuestion(lastInbound))

  // ── Owner authority first: identity, then facts, then how to behave. The
  //    customer's words come last, fenced, with the authority restated after.
  const lines: string[] = []

  if (args.businessIdentityBlock) lines.push(args.businessIdentityBlock)
  else if (args.guidance) {
    lines.push(`זהות העסק (עובדות מאומתות של העסק שאת/ה מייצג/ת; מותר לצטט): ${args.guidance}`)
    lines.push('אסור להמציא שירות, מחיר, מדיניות, התחייבות או מועד שלא כתוב כאן.')
  }
  if (args.productKnowledgeBlock) lines.push(args.productKnowledgeBlock)

  lines.push(`מידע פנימי שכבר נאסף (לא להזכיר ללקוח, לא לקבוע לפי זה את השאלה הבאה): ${have || '(אין)'}`)
  if (args.answeringOurRequest) {
    lines.push(
      'הלקוח/ה בדיוק ענה/תה לשאלה ששאלת. אשר/י בקצרה את מה שנמסר (בשם, אם נמסר שם), ' +
        'והמשך/המשיכי מהנקודה הזו. אסור לחזור ולהסביר מה העסק עושה, ואסור לשאול שוב את אותה שאלה.',
    )
    lines.push(
      'סוג העסק ("מספרת כלבים", "מוסך", "מרפאה") הוא לא שם העסק. אל תתייחס/י אליו כשם, ' +
        'אל תמציא/י שם, ואל תדרוש/דרשי שם אלא אם באמת אי אפשר להמשיך בלעדיו.',
    )
  }
  if (args.handoffAlreadyOffered) {
    lines.push(
      'כבר הצעת להעביר את הפנייה לאדם מהצוות והלקוח/ה לא סירב/ה. אל תבקש/י את אותו אישור שוב — ' +
        'קדם/י את הצעד הזה.',
    )
  }
  lines.push(formatCognitionMemory(args.qualification.cognition, productMode ? 'product' : 'discover'))

  if (needKnown && !productMode) {
    lines.push(
      'הלקוח תיאר צורך או בעיה. קודם כל הגיב/י לזה. אל תשאל/י לשם ואל תשאל/י "מה הצורך שלך" אם הצורך כבר נאמר.',
    )
  }
  if (args.salesStrategy === 'explain' || args.salesMove === 'PRODUCT_QUESTION') {
    if (args.salesStrategy === 'explain') {
      lines.push(
        'הלקוח ביקש או אישר הסבר. הסבר/י מהעובדות המאומתות של העסק. אפס שאלות זה תקין. אל תשאל/י שאלת בירור.',
      )
    } else {
      lines.push(
        'זו שאלה על מה שהעסק מציע. ענה/י קודם מהעובדות המאומתות. אל תשאל/י שאלת בירור לפני התשובה. לכל היותר שאלת המשך אחת אחרי התשובה. אם אין עובדה מאומתת — אל תמציא/י, אמור/אמרי שאין לך את הפרט והצע/י שאדם מהצוות יחזור.',
      )
    }
  }
  if (args.salesMove === 'PRODUCT_FIT') {
    lines.push(
      'הלקוח רוצה לדעת אם זה מתאים לו. הסבר/י מהעובדות המאומתות מה העסק עושה בשביל הצורך שנאמר. אל תשאל/י שאלת בירור נוספת עכשיו. שאלה רק אם היא צעד טבעי אחרי שהערך ברור. אם אין עובדה מאומתת — אל תמציא/י.',
    )
  }
  if (args.salesMove === 'BUYING_SIGNAL') {
    lines.push(
      'הלקוח שואל איך מתקדמים. ענה/י רק מצעד שמופיע במפורש בזהות העסק. אסור להמציא תהליך הצטרפות, טופס, או שלב כלשהו. אם אין צעד כזה בזהות העסק — אמור/אמרי בכנות שאין לך את הפרט הזה ושאדם מהצוות יכול לכוון. אל תעביר/י לאדם מיוזמתך ואל תתחיל/י בירור מחדש.',
    )
  }
  if (args.salesMove === 'OBJECTION') {
    lines.push('זו התנגדות. התייחס/י אליה מהעובדות המאומתות. אל תתעלם/י ואל תמשיך/י בירור.')
  }
  if (args.salesMove === 'CASUAL_ACKNOWLEDGEMENT') {
    lines.push('זו הודעת תודה או אישור קצר. סגירה קצרה מספיקה. אל תעביר/י לאדם ואל תמציא/י שמישהו מהצוות יחזור.')
  }
  if (args.discoveryBudgetExhausted && (args.salesMove === 'DISCOVERY' || args.salesMove === 'DEEPEN' || !args.salesMove)) {
    lines.push(
      'תקציב שאלות הבירור היזומות הסתיים. אל תשאל/י שאלת בירור נוספת מיוזמתך. אם הלקוח שאל משהו קונקרטי — ענה/י לו במלואו. אחרת הכר/י בקצרה בלי דיג ובלי שאלה.',
    )
  }
  if (isBusinessIdentityQuestion(lastInbound)) {
    lines.push(
      'זו שאלת זהות העסק. ענה/י ישירות מזהות העסק למעלה. אל תשאל/י את הלקוח על העסק, מאיזה קישור הגיע, או לבקש צילום מסך.',
    )
  }
  if (args.greetingLine) {
    lines.push(
      [
        'זו ההודעה הראשונה שלך בשיחה הזו. פתח/י בדיוק בשורה הבאה, מילה במילה, ואז המשך/המשיכי לתוכן באותה הודעה:',
        args.greetingLine,
        'אל תשנה/י את הניסוח, אל תוסיף/י ברכה שנייה, ואל תחזור/חזרי על שם העסק בהמשך ההודעה.',
      ].join('\n'),
    )
  }
  if (args.regenerationReason) lines.push(REGEN_CONSTRAINT[args.regenerationReason])
  if (args.responseProfile) lines.push(formatDeliveryBlock(args.responseProfile))

  // The summary sits with the other memory the agent is given, BEFORE the
  // fenced transcript — it is our own note about the conversation, not customer
  // text, and must not read as something the customer said.
  if (args.summaryBlock) lines.push(args.summaryBlock)

  lines.push(fenceTranscript(args.transcript))
  lines.push(fenceReminder())

  return lines.join('\n\n')
}
