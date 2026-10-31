import type { EvalCase } from './cases'

/**
 * P1 revenue cases (EVAL_SET=revenue) — a separate set, so the P0 set and its
 * recorded runs stay comparable.
 *
 * Seeded in the eval tenant (agency 41, local eval database only), dated by
 * offer date, run on 2026-11-01:
 *   paid   12,000 (2026-03-10) · 8,500 (2026-10-05) · 3,000 (2025-11-20)
 *   open   בהצעה 5,000 (2026-10-12) · במו"מ 2,500 (2026-09-01)
 *   בוטל   9,999 (2026-10-01) — never counted
 * So: this year paid 20,500 (2 deals), pipeline 7,500; last month paid 8,500,
 * pipeline 5,000; last year paid 3,000; March 2026 paid 12,000; this month
 * nothing. 28,000 (paid + pipeline) or 30,499 (with the cancelled deal) in a
 * reply means the two were conflated.
 */
const N = (n: string) => new RegExp(n.replace(',', '[,.]?'))
const CONFLATED = [N('28,000'), N('30,499'), N('9,999'), /לא מצאתי במערכת מספיק נתונים/]

export const REVENUE_CASES: readonly EvalCase[] = [
  {
    id: 'R1',
    kind: 'financial',
    origin: 'real',
    prodId: 50,
    question: 'כמה העסק שלי עשה השנה?',
    tool: 'get_revenue',
    mustMatch: [N('20,500')],
    mustNotMatch: CONFLATED,
  },
  {
    id: 'R2',
    kind: 'financial',
    origin: 'synthetic',
    question: 'כמה כסף נכנס בחודש שעבר?',
    tool: 'get_revenue',
    mustMatch: [N('8,500')],
    mustNotMatch: CONFLATED,
  },
  {
    id: 'R3',
    kind: 'financial',
    origin: 'synthetic',
    question: 'כמה הכנסתי בשנה שעברה?',
    tool: 'get_revenue',
    mustMatch: [N('3,000')],
    mustNotMatch: CONFLATED,
  },
  {
    id: 'R4',
    kind: 'financial',
    origin: 'synthetic',
    question: 'כמה יש לי בפייפליין השנה?',
    tool: 'get_revenue',
    mustMatch: [N('7,500')],
    mustNotMatch: CONFLATED,
  },
  {
    id: 'R5',
    kind: 'financial',
    origin: 'synthetic',
    question: 'מה היו ההכנסות בין 1 במרץ ל-31 במרץ 2026?',
    tool: 'get_revenue',
    mustMatch: [N('12,000')],
    mustNotMatch: CONFLATED,
  },
  {
    id: 'R6',
    kind: 'financial',
    origin: 'synthetic',
    question: 'כמה אני צפוי להכניס החודש?',
    mustMatch: [/תחזית|לחזות|צפי|צפוי/],
    mustNotMatch: [...CONFLATED, /צפוי להכניס [\d₪]/],
  },
  {
    id: 'R7',
    kind: 'financial',
    origin: 'real',
    prodId: 50,
    question: 'כמה כסף נכנס החודש?',
    tool: 'get_revenue',
    mustNotMatch: [...CONFLATED, /אין (במערכת )?עסקאות רשומות/],
  },
  {
    id: 'R8',
    kind: 'financial',
    origin: 'synthetic',
    question: 'תן לי את ההכנסות והפייפליין של השנה',
    tool: 'get_revenue',
    mustMatch: [N('20,500'), N('7,500')],
    mustNotMatch: CONFLATED,
  },
]
