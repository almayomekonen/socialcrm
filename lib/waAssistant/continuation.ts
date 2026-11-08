/**
 * Does this message answer the question we are waiting on, or is it something
 * new? Pure. Judged against the ACTUAL pending question, not by whether the
 * message happens to contain an action word:
 *
 *   "תקבע פגישה עם אבי מחר" → "באיזו שעה?" → "תקבע ב-11"     answers it
 *   "תקבע פגישה עם אבי מחר" → "באיזו שעה?" → "להתקשר לרון"  something new
 *
 * WHEN questions (which day, which hour): the reply continues the request only
 * if it says nothing beyond a day or time, filler, this kind's own action words,
 * and words already in the request. Any other word is new content, and new
 * content in reply to "באיזו שעה?" is a new request; never merged. An unknown
 * word therefore fails toward a fresh request, which the owner sees on the card.
 *
 * WHO / WHAT questions ("לאיזה ליד?", the Agent's own question): the answer is
 * itself new content, so a name is expected. It is a new request only if it
 * opens one, asks something else, or (for a meeting) names a task to do.
 */

export type RequestKind = 'meeting' | 'task' | 'status' | 'note' | 'quote'

const words = (...lists: string[]) => new Set(lists.join(' ').split(' '))

const FILLER = words(
  // Day and time.
  'שעה שעות יום היום מחר מחרתיים ראשון שני שלישי רביעי חמישי שישי שבת הבא הקרוב בעוד ימים שבוע שבועות שבועיים יומיים',
  'אחד אחת שניים שתיים שתי שלושה שלוש ארבעה ארבע חמישה חמש שישה שש שבעה שבע שמונה תשעה תשע עשרה עשר',
  'בוקר צהריים ערב לילה אחר אחרי אחה צ לפני אחרי בערך',
  // Conversation.
  'כן לא אוקי אוקיי ok okay סבבה טוב בסדר בטח יאללה נכון תודה רגע שנייה רק אז בעצם אולי נגיד עדיף יותר מאוחר מוקדם בבקשה אפשר',
  'לי לנו את זה זאת של עם על גם ש ב ל ו ה מ',
  // The request itself, pointed back to.
  'ליד הליד אותו אותה הזה הזאת הזו איתו איתה אליו אליה לו לה',
  // Verbs that fit any kind: "תקבע ב-11".
  'תקבע קבע לקבוע נקבע נעשה תעשה תרשום תשים שים בוא',
)
const OWN_WORDS: Record<RequestKind, Set<string>> = {
  meeting: words('פגישה פגישת פגישות'),
  task: words('משימה משימת משימות מעקב תזכורת תיצור צור ליצור תפתח פתח לפתוח תזכיר'),
  status: words('סטטוס הסטטוס תעביר להעביר העבר תסמן לסמן סמן תשנה לשנות שנה תעדכן לעדכן עדכן'),
  note: words('הערה הערות תרשום לרשום רשום תוסיף להוסיף הוסף תכתוב לכתוב'),
  quote: words('הצעה הצעת הצעות מחיר מחירים תכין להכין הכן מעמ מע מ כולל לפני פלוס ללא בלי שקל שקלים ש ח אלף תוקף ימים'),
}
const WHEN_ASKS = new Set(['ask_time', 'ambiguous_time', 'ambiguous_date', 'past_date', 'past', 'past_today', 'conflict'])

/** Hebrew attaches prepositions to the word: "לרון", "ביום", "ולמחר". */
const PREFIXES = /^[ולבהשמ]{1,2}/u
const tokens = (text: string) =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
const forms = (t: string) => [t, t.replace(/^[ולבהשמ]/u, ''), t.replace(PREFIXES, '')].filter(Boolean)

/** The words in `text` that are neither a day or time, nor filler, nor already part of the request. */
function newContent(kind: RequestKind, text: string, request: readonly string[]): string[] {
  const known = new Set(request.flatMap((m) => tokens(m).flatMap(forms)))
  return tokens(text).filter(
    (t) => !/\d/u.test(t) && !forms(t).some((f) => FILLER.has(f) || OWN_WORDS[kind].has(f) || known.has(f)),
  )
}

/**
 * Names an action, or commands one. "תקבע" alone is not here: "תקבע ב-11" answers
 * "באיזו שעה?". A bare "משימה" answers "משימה או מעקב?", so it does not open one.
 */
const OPENS_REQUEST =
  /(?:^|[^\p{L}])(?:[ולה]?(?:משימ\p{L}*|פגיש\p{L}*|מעקב|תזכורת)|תיצור|ליצור|צור|תפתח|לפתוח|פתח|תזכיר|תרשום|תוסיף)(?![\p{L}])/u
const BARE_ACTION = /^\s*[ולה]?(?:משימה|פגישה|מעקב|תזכורת)[\s.!]*$/u
/** A meeting has no "something to do": this is a task, even with no action word. */
const TASK_TO_DO =
  /(?:^|[^\p{L}])(?:להתקשר|תתקשר|לחזור|תחזור|לבדוק|תבדוק|לשלוח|תשלח|לעדכן|תעדכן|לדבר|תדבר|לכתוב|תכתוב|להזכיר)(?![\p{L}])/u
/** "לליד הזה", "אותו ליד", "תפתח לו": the owner points back, so the Agent keeps the earlier turns. */
const POINTS_BACK = /(?:^|[^\p{L}])(?:אותו|אותה|הזה|הזאת|הזו|אליו|אליה|איתו|איתה|לו|לה)(?![\p{L}])/u

export const opensRequest = (text: string): boolean => OPENS_REQUEST.test(text) && !BARE_ACTION.test(text)
export const pointsBack = (text: string): boolean => POINTS_BACK.test(text)

/**
 * `pendingStopReason` is the question we asked ("meeting_clarify_ask_time");
 * `request` is what the owner has said in this request so far.
 */
export function answersPending(input: {
  kind: RequestKind
  pendingStopReason: string
  text: string
  request: readonly string[]
}): boolean {
  const { kind, text, request } = input
  const fresh = newContent(kind, text, request)
  const asked = input.pendingStopReason.slice(`${kind}_clarify_`.length)
  if (WHEN_ASKS.has(asked)) return fresh.length === 0
  if (!fresh.length) return true
  if (opensRequest(text) || /[?？]\s*$/u.test(text)) return false
  return !(kind === 'meeting' && TASK_TO_DO.test(text))
}
