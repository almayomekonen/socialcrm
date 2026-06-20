/**
 * Live-review harness for the Operator Take pilot.
 *
 * Pushes 20 realistic conversations' candidate takes through the REAL gate
 * (selectRenderableTake) so the surface/silence decision is genuine code output.
 * The `obviousToPro` flag is a HUMAN judgment (answer to: "would a competent
 * salesperson already have noticed this?") and is what the pilot is graded on.
 *
 * NOTE: the candidate takes here are authored to the v4 analyzer contract — they
 * simulate the analyzer's output. They are NOT a live LLM run against production
 * (that needs provider keys + DB + the worker). Use this to validate the GATE and
 * to calibrate the non-obviousness bar; replace with real analyzer output before
 * declaring the pilot validated.
 *
 * Run: npx tsx scripts/operatorTakeReview.ts
 */
import { selectRenderableTake } from '../lib/inbox/intelligence/operatorTake'

type Msg = { seq: number; dir: 'ליד' | 'נציג'; text: string }
type Fixture = {
  id: number
  title: string
  convo: Msg[]
  take: { actionMessage: string; reason: string; noveltyKind: string; suggestedAction: string; sourceMessageIds: number[] }
  status?: 'fresh' | 'stale' | 'failed'
  obviousToPro: boolean // human judgment
}

const F: Fixture[] = [
  {
    id: 1, title: 'שאלת תשלומים שנקברה',
    convo: [{ seq: 1, dir: 'ליד', text: 'כמה זה עולה?' }, { seq: 2, dir: 'נציג', text: 'שלחתי הצעה' }, { seq: 3, dir: 'ליד', text: 'אפשר לפצל לתשלומים?' }, { seq: 4, dir: 'נציג', text: 'המוצר כולל גם תמיכה' }, { seq: 5, dir: 'ליד', text: 'אוקיי' }],
    take: { actionMessage: 'תחזור לשאלה על פיצול התשלומים — שאל ולא נענה', reason: 'שאל על תשלומים בהודעה 3 ולא קיבל מענה', noveltyKind: 'attention', suggestedAction: 'answer_question', sourceMessageIds: [3] },
    obviousToPro: false,
  },
  {
    id: 2, title: 'משווה, לא מתמקח',
    convo: [{ seq: 1, dir: 'ליד', text: 'בודק גם את X וגם את Y' }, { seq: 2, dir: 'נציג', text: 'אני יכול להוריד 10%' }, { seq: 3, dir: 'ליד', text: 'מה ההבדל ביניכם לבין X?' }],
    take: { actionMessage: 'אל תוריד מחיר — הוא משווה אלטרנטיבות, לא מתמקח. תבדל את הערך', reason: 'הזכיר מתחרים והשוואה (1,3), לא ביקש הנחה', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [1, 3] },
    obviousToPro: false,
  },
  {
    id: 3, title: 'נתקע אחרי ההצעה, לא המחיר',
    convo: [{ seq: 1, dir: 'ליד', text: 'המחיר נשמע סביר' }, { seq: 2, dir: 'נציג', text: 'מעולה, שולח הצעה מסודרת' }, { seq: 3, dir: 'נציג', text: '[קובץ הצעה]' }, { seq: 4, dir: 'ליד', text: '' }],
    take: { actionMessage: 'הבעיה היא ההצעה עצמה — נתקע אחריה, לא אחרי המחיר. התקשר לעבור עליה יחד', reason: 'אישר מחיר (1), השיחה נפסקה מיד אחרי ההצעה (3)', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [1, 3] },
    obviousToPro: false,
  },
  {
    id: 4, title: 'ממתין — מובן מאליו',
    convo: [{ seq: 1, dir: 'ליד', text: 'אחזור אליך מחר' }, { seq: 2, dir: 'נציג', text: 'מעולה' }],
    take: { actionMessage: 'שלח תזכורת, הוא עדיין לא חזר', reason: 'אמר שיחזור ולא חזר', noveltyKind: 'none', suggestedAction: 'follow_up', sourceMessageIds: [1] },
    obviousToPro: true,
  },
  {
    id: 5, title: 'בדיקה עם השותף ×2',
    convo: [{ seq: 1, dir: 'ליד', text: 'צריך לבדוק עם השותף' }, { seq: 2, dir: 'נציג', text: 'בטח' }, { seq: 3, dir: 'ליד', text: 'עוד לא הספקתי לדבר עם השותף' }],
    take: { actionMessage: 'תציע שיחה משותפת עם השותף — זו התנגדות אמיתית, לא נימוס', reason: 'הזכיר את השותף פעמיים (1,3) כחסם', noveltyKind: 'interpretation', suggestedAction: 'schedule_demo', sourceMessageIds: [1, 3] },
    obviousToPro: false,
  },
  {
    id: 6, title: 'אי-התאמת נושא',
    convo: [{ seq: 1, dir: 'ליד', text: 'תוך כמה זמן זה מגיע?' }, { seq: 2, dir: 'נציג', text: 'המחיר הוא 1200' }, { seq: 3, dir: 'ליד', text: 'שאלתי על זמן אספקה' }],
    take: { actionMessage: 'ענה קודם על זמן האספקה — שאל פעמיים וקיבל מחיר במקום', reason: 'שאל על אספקה (1,3), נענה על מחיר', noveltyKind: 'attention', suggestedAction: 'answer_question', sourceMessageIds: [1, 3] },
    obviousToPro: false,
  },
  {
    id: 7, title: '"הכדור אצלך" — denylist',
    convo: [{ seq: 1, dir: 'ליד', text: 'נשמע טוב' }, { seq: 2, dir: 'נציג', text: 'אשמח להתקדם' }, { seq: 3, dir: 'ליד', text: 'אחשוב על זה' }],
    take: { actionMessage: 'הכדור אצלך עכשיו', reason: 'הליד הגיב אחרון', noveltyKind: 'attention', suggestedAction: 'follow_up', sourceMessageIds: [3] },
    obviousToPro: true,
  },
  {
    id: 8, title: 'איתות קנייה חם',
    convo: [{ seq: 1, dir: 'ליד', text: 'כמה זמן לוקח להתחיל?' }, { seq: 2, dir: 'נציג', text: 'אפשר תוך שבוע' }, { seq: 3, dir: 'ליד', text: 'מעולה, בוא נתקדם' }],
    take: { actionMessage: 'שלח עכשיו לינק/הצעה לסגירה — ביקש במפורש להתקדם', reason: 'אמר "בוא נתקדם" (3)', noveltyKind: 'action', suggestedAction: 'close_lead', sourceMessageIds: [3] },
    obviousToPro: true,
  },
  {
    id: 9, title: 'התקררות אחרי מחיר',
    convo: [{ seq: 1, dir: 'ליד', text: 'מאוד מעניין אותי' }, { seq: 2, dir: 'ליד', text: 'יש לכם ניסיון בתחום שלי?' }, { seq: 3, dir: 'נציג', text: 'בהחלט. המחיר 1500 לחודש' }, { seq: 4, dir: 'ליד', text: 'הבנתי, תודה' }],
    take: { actionMessage: 'אל תרדוף — שלח עדות מלקוח דומה, השיחה התקררה רגע אחרי המחיר', reason: 'היה מתעניין (1,2), הצטנן מיד אחרי המחיר (3,4)', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [2, 4] },
    obviousToPro: false,
  },
  {
    id: 10, title: 'לא מבוסס — ungrounded',
    convo: [{ seq: 1, dir: 'ליד', text: 'היי' }, { seq: 2, dir: 'נציג', text: 'היי, איך אפשר לעזור?' }],
    take: { actionMessage: 'הוא כנראה מתעניין במוצר הפרימיום', reason: 'תחושה כללית', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [] },
    obviousToPro: false,
  },
  {
    id: 11, title: 'שיחה בריאה — אין מה לומר',
    convo: [{ seq: 1, dir: 'ליד', text: 'יש אחריות?' }, { seq: 2, dir: 'נציג', text: 'כן, שנתיים מלאות' }, { seq: 3, dir: 'ליד', text: 'מושלם, מתקדמים' }],
    take: { actionMessage: '', reason: '', noveltyKind: 'none', suggestedAction: 'none', sourceMessageIds: [] },
    obviousToPro: true,
  },
  {
    id: 12, title: 'התנגדות מחיר שהתעלמו ממנה',
    convo: [{ seq: 1, dir: 'ליד', text: 'המחיר קצת גבוה לי' }, { seq: 2, dir: 'נציג', text: 'יש לנו גם אפליקציה וגם דשבורד' }, { seq: 3, dir: 'ליד', text: 'אוקיי' }],
    take: { actionMessage: 'תתייחס ישירות להתנגדות המחיר, אל תתעלם', reason: 'אמר שהמחיר גבוה (1), נענה בפיצ\'רים', noveltyKind: 'action', suggestedAction: 'answer_question', sourceMessageIds: [1] },
    obviousToPro: true,
  },
  {
    id: 13, title: 'ביקש המלצות ולא קיבל',
    convo: [{ seq: 1, dir: 'ליד', text: 'יש לקוחות שאפשר לדבר איתם?' }, { seq: 2, dir: 'נציג', text: 'נשמח לעזור בכל שאלה' }, { seq: 3, dir: 'ליד', text: '' }],
    take: { actionMessage: 'שלח לו המלצות/לקוחות לדוגמה — זה מה שעוצר אותו', reason: 'ביקש רפרנסים (1) ולא קיבל', noveltyKind: 'attention', suggestedAction: 'answer_question', sourceMessageIds: [1] },
    obviousToPro: false,
  },
  {
    id: 14, title: 'תזמון, לא אובדן',
    convo: [{ seq: 1, dir: 'ליד', text: 'מעניין אבל לא עכשיו, אולי בעוד חודש' }, { seq: 2, dir: 'נציג', text: 'אין בעיה' }],
    take: { actionMessage: 'אל תסמן כאבוד — קבע תזכורת לעוד חודש, זה תזמון ולא חוסר עניין', reason: 'אמר "מעניין אבל לא עכשיו" (1)', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [1] },
    obviousToPro: false,
  },
  {
    id: 15, title: 'אחרי סגירה — אין מה לומר',
    convo: [{ seq: 1, dir: 'נציג', text: 'ברוך הבא! הכל מוכן' }, { seq: 2, dir: 'ליד', text: 'תודה רבה!' }],
    take: { actionMessage: '', reason: '', noveltyKind: 'none', suggestedAction: 'none', sourceMessageIds: [] },
    obviousToPro: true,
  },
  {
    id: 16, title: 'הטון התקרר',
    convo: [{ seq: 1, dir: 'ליד', text: 'וואו זה בדיוק מה שחיפשתי!! ספר לי עוד' }, { seq: 2, dir: 'נציג', text: 'בכיף, הנה פירוט מלא...' }, { seq: 3, dir: 'ליד', text: 'הבנתי' }, { seq: 4, dir: 'ליד', text: 'אוקיי' }],
    take: { actionMessage: 'הטון צנח — בדוק בעדינות אם משהו הרתיע, אל תלחץ למכירה', reason: 'התלהבות (1) מול תשובות קצרות (3,4)', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [1, 4] },
    obviousToPro: false,
  },
  {
    id: 17, title: 'אחריות לפני סגירה',
    convo: [{ seq: 1, dir: 'ליד', text: 'מה לגבי אחריות?' }, { seq: 2, dir: 'נציג', text: 'בוא נקבע שיחת סגירה' }, { seq: 3, dir: 'ליד', text: 'רגע, שאלתי על אחריות' }],
    take: { actionMessage: 'ענה על האחריות לפני שתדחוף לסגירה — זה מה שמטריד אותו', reason: 'שאל על אחריות פעמיים (1,3), נדחף לסגור', noveltyKind: 'attention', suggestedAction: 'answer_question', sourceMessageIds: [1, 3] },
    obviousToPro: false,
  },
  {
    id: 18, title: 'שאלת מחיר מפורשת',
    convo: [{ seq: 1, dir: 'ליד', text: 'כמה זה עולה?' }, { seq: 2, dir: 'נציג', text: 'תכף בודק' }],
    take: { actionMessage: 'שלח לו מחיר', reason: 'שאל מחיר (1) ולא קיבל', noveltyKind: 'attention', suggestedAction: 'answer_question', sourceMessageIds: [1] },
    obviousToPro: true,
  },
  {
    id: 19, title: 'דחה שלוש פגישות',
    convo: [{ seq: 1, dir: 'ליד', text: 'בוא נדבר מחר' }, { seq: 2, dir: 'ליד', text: 'סליחה, אפשר לדחות?' }, { seq: 3, dir: 'ליד', text: 'יצא לי משהו, נדבר בשבוע הבא' }],
    take: { actionMessage: 'שאל ישירות מה מעכב — דחה שלוש פעמים, זה היסוס ולא תזמון', reason: 'שלוש דחיות רצופות (1,2,3)', noveltyKind: 'interpretation', suggestedAction: 'follow_up', sourceMessageIds: [1, 2, 3] },
    obviousToPro: false,
  },
  {
    id: 20, title: 'מנומס אבל לא מתחייב',
    convo: [{ seq: 1, dir: 'נציג', text: 'אז מה דעתך?' }, { seq: 2, dir: 'ליד', text: 'נשמע נחמד, תודה על המידע' }],
    take: { actionMessage: 'שאל ישירות אם רוצים להתקדם — מנומס אבל לא מתחייב, תחסוך ניחושים', reason: 'תגובה מנומסת ולא-מחייבת (2)', noveltyKind: 'action', suggestedAction: 'follow_up', sourceMessageIds: [2] },
    obviousToPro: false,
  },
]

let surfaced = 0
let silenced = 0
let nonObviousSurfaced = 0
const rows: string[] = []

for (const f of F) {
  const t = selectRenderableTake(100 + f.id, {
    data: {
      suggestedAction: f.take.suggestedAction,
      reason: f.take.reason,
      actionMessage: f.take.actionMessage,
      noveltyKind: f.take.noveltyKind as any,
      sourceMessageIds: f.take.sourceMessageIds,
    },
    status: f.status ?? 'fresh',
    coveredSequence: f.convo[f.convo.length - 1].seq,
    promptVersion: '4',
  })
  const shown = t !== null
  if (shown) {
    surfaced++
    if (!f.obviousToPro) nonObviousSurfaced++
  } else {
    silenced++
  }
  const verdict = shown ? (f.obviousToPro ? 'SURFACED · pro-would-notice' : 'SURFACED · genuine') : 'SILENCED'
  rows.push(`#${String(f.id).padStart(2)} ${f.take.noveltyKind.padEnd(14)} ${verdict}`)
}

console.log('\n=== Operator Take — live review (gate decisions are REAL code) ===\n')
console.log(rows.join('\n'))
console.log('\n--- summary ---')
console.log(`total conversations:        ${F.length}`)
console.log(`surfaced (passed gate):     ${surfaced}`)
console.log(`silenced (Law 4):           ${silenced}`)
console.log(`genuine among surfaced:     ${nonObviousSurfaced}/${surfaced} = ${Math.round((nonObviousSurfaced / surfaced) * 100)}%`)
console.log(`(metric = % of SHOWN takes a competent salesperson would NOT already have noticed)\n`)
