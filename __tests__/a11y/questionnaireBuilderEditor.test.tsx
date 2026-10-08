// @vitest-environment jsdom
//
// The Questionnaire Builder conversation editor (PR2), driven like an owner
// drives it: type, pick, tick, reorder, test, publish, restore.
//
// The server actions are replaced by an in-memory server built from the REAL
// PR1 domain (assignIds, toDefinition, normalizeCustomerText, draftState,
// simulateConversation), so ids, versions, refs and readiness behave as they
// do in production. Only storage is fake.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { assignIds } from '@/lib/inbox/autoresponse/questionnaire/builder/ids'
import { toDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { normalizeCustomerText } from '@/lib/inbox/autoresponse/questionnaire/builder/normalize'
import { draftState, type DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'
import { builderQuestionnaireSchema } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { checkDefinitionForPublish } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'

// ── In-memory server over the real domain ───────────────────────────────────

type Server = {
  id: number
  version: number
  base: number | null
  def: QuestionnaireDefinition
  published: QuestionnaireDefinition[]
}
const S = vi.hoisted(() => ({ server: null as unknown as Server, conflictNextSave: false, calls: [] as string[] }))

const row = () => ({
  id: S.server.id,
  agencyId: 158,
  channel: 'whatsapp',
  status: 'draft' as const,
  revision: null,
  definition: S.server.def,
  draftVersion: S.server.version,
  baseRevision: S.server.base,
  source: 'builder' as const,
  createdBy: 5,
  updatedBy: 5,
  updatedAt: '2026-10-07T10:00:00.000Z',
  publishedBy: null,
  publishedAt: null,
})

const A = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  discard: vi.fn(),
  simulate: vi.fn(),
  publish: vi.fn(),
  list: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/actions/questionnaire/builderDraft', () => ({
  openQuestionnaireDraft: A.open,
  saveQuestionnaireDraft: A.save,
  checkQuestionnaireDraft: A.check,
  discardQuestionnaireDraft: A.discard,
}))
vi.mock('@/actions/questionnaire/builderPublish', () => ({
  simulateQuestionnaireDraft: A.simulate,
  publishQuestionnaireDraft: A.publish,
  listQuestionnaireRevisions: A.list,
}))
vi.mock('@/lib/toast', () => ({ toast: A.toast }))

function installServer() {
  A.open.mockImplementation(async (input: { fromRevision?: number } = {}) => {
    S.calls.push(`open${input.fromRevision ? `:${input.fromRevision}` : ''}`)
    const latest = S.server.published.length
    const source = input.fromRevision ? S.server.published[input.fromRevision - 1] : S.server.published[latest - 1]
    S.server = { ...S.server, id: S.server.id + 1, version: 1, base: latest || null, def: { ...source, revision: latest + 1 } }
    return { ok: true, ...draftState(row()) }
  })
  A.save.mockImplementation(async (input: { draftId: number; expectedVersion: number; questionnaire: unknown }) => {
    S.calls.push(`save:v${input.expectedVersion}`)
    if (S.conflictNextSave || input.expectedVersion !== S.server.version) {
      return { ok: false, reason: 'version_conflict', currentVersion: S.server.version + 1 }
    }
    const parsed = builderQuestionnaireSchema.safeParse(input.questionnaire)
    if (!parsed.success) return { ok: false, reason: 'invalid_draft', issues: [{ code: 'invalid', severity: 'error' }] }
    const ids = assignIds(S.server.def, normalizeCustomerText(parsed.data))
    if (ids.ok === false) return { ok: false, reason: 'invalid_draft', issues: [{ code: ids.error.code, severity: 'error' }] }
    const converted = toDefinition(ids.questionnaire, S.server.def.revision)
    if (converted.ok === false)
      return { ok: false, reason: 'invalid_draft', issues: [{ code: converted.error.code, severity: 'error' }] }
    S.server = { ...S.server, def: converted.definition, version: S.server.version + 1 }
    return { ok: true, assigned: ids.assigned, ...draftState(row()) }
  })
  A.check.mockImplementation(async () => ({ ok: true, ...checkDefinitionForPublish(S.server.def) }))
  A.discard.mockImplementation(async (input: { expectedVersion: number }) => {
    S.calls.push(`discard:v${input.expectedVersion}`)
    return input.expectedVersion === S.server.version
      ? { ok: true }
      : { ok: false, reason: 'version_conflict', currentVersion: S.server.version }
  })
  A.simulate.mockImplementation(async (input: { draftId: number; turns: string[][] }) => ({
    ok: true,
    ...simulateConversation(S.server.def, input.turns),
  }))
  A.publish.mockImplementation(async (input: { expectedVersion: number }) => {
    if (input.expectedVersion !== S.server.version)
      return { ok: false, reason: 'version_conflict', currentVersion: S.server.version }
    S.server.published = [...S.server.published, S.server.def]
    return { ok: true, revision: S.server.published.length, publishedAt: '2026-10-07T10:05:00.000Z' }
  })
  A.list.mockImplementation(async () => ({
    ok: true,
    revisions: S.server.published
      .map((_, i) => ({
        revision: i + 1,
        publishedAt: '2026-10-07T10:05:00.000Z',
        publishedBy: 5,
        publishedByName: i === 0 ? null : 'דנה כהן',
        source: i === 0 ? 'backfill' : 'builder',
        activeSessions: i === 0 ? 1 : 0,
      }))
      .reverse(),
  }))
}

import QuestionnaireBuilder from '@/components/settings/questionnaire/QuestionnaireBuilder'

const load = (file: string): QuestionnaireDefinition => {
  const parsed = parseQuestionnaireDefinition(
    fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'),
  )
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')
const pilot = load('socialcrm-pilot.he.json')

const ROUTED = { routedToQuestionnaire: true, channelEnabled: true, masterEnabled: true }

function start(def: QuestionnaireDefinition, published: QuestionnaireDefinition[] = []): DraftState {
  S.server = { id: 1, version: 1, base: published.length || null, def: { ...def, revision: published.length + 1 }, published }
  return draftState(row())
}

function mount(initial: DraftState | null, live: number | null = null) {
  return render(<QuestionnaireBuilder initialDraft={initial} liveRevision={live} routing={ROUTED} />)
}

const card = (n: number) => screen.getByRole('article', { name: new RegExp(`^שאלה ${n}(?!\\d)`) })
const preview = () => screen.getByRole('region', { name: 'מה הלקוח יקבל' })
const saved = () => waitFor(() => expect(screen.getByText(/נשמר$/)).toBeTruthy(), { timeout: 3000 })

beforeEach(() => {
  S.conflictNextSave = false
  S.calls = []
  installServer()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── First run ────────────────────────────────────────────────────────────────

describe('first run', () => {
  it('opens a draft through PR1 and lands on a natural opening, a first question and "הוספת שאלה"', async () => {
    S.server = { id: 0, version: 0, base: null, def: emptyQuestionnaire('Demo — Yuton'), published: [] }
    A.open.mockImplementationOnce(async () => {
      S.server = { ...S.server, id: 8, version: 1 }
      return { ok: true, ...draftState(row()) }
    })
    mount(null)
    expect(screen.getByText('פותח את השאלון…')).toBeTruthy()
    const opening = (await screen.findByLabelText('הודעת הפתיחה')) as HTMLTextAreaElement
    expect(opening.value).toContain('תודה שפניתם ל־Demo Yuton.')
    expect(opening.value).not.toMatch(/[—–-]/)
    expect(within(card(1)).getByDisplayValue('במה נוכל לעזור?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'הוספת שאלה' })).toBeTruthy()
    expect(screen.getByText('השאלון עוד לא פורסם. הלקוחות לא מקבלים אותו.')).toBeTruthy()
    // A blank to fill in, not a wall of red: nothing is flagged until the owner has been there.
    expect(within(card(1)).queryByText('כתבו שם לאפשרות.')).toBeNull()
    fireEvent.focusOut(within(card(1)).getByLabelText('שם האפשרות 1'), { relatedTarget: null })
    expect(within(card(1)).getAllByText('כתבו שם לאפשרות.')).toHaveLength(2)
  })

  it('a salon builds opening → service → preferred date → ending, with autosave, and it is ready', async () => {
    mount(start(emptyQuestionnaire('סלון דנה')))
    const c1 = card(1)
    fireEvent.change(within(c1).getByLabelText('שם האפשרות 1'), { target: { value: 'תספורת' } })
    fireEvent.change(within(c1).getByLabelText('שם האפשרות 2'), { target: { value: 'צבע' } })
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה' }))
    const c2 = card(2)
    fireEvent.change(within(c2).getByLabelText('סוג התשובה'), { target: { value: 'free' } })
    fireEvent.change(within(c2).getByLabelText('בדיקת התשובה'), { target: { value: 'date' } })
    fireEvent.change(within(c2).getByLabelText('נוסח השאלה'), { target: { value: 'לאיזה תאריך תרצו לקבוע?' } })
    // No separate naming step: the summary name follows the question.
    expect((within(c2).getByLabelText('שם קצר לסיכום שהנציג מקבל') as HTMLInputElement).value).toBe('לאיזה תאריך תרצו לקבוע')
    await saved()
    expect(checkDefinitionForPublish(S.server.def).ready).toBe(true)
    expect(S.server.def.steps.map((s) => s.type)).toEqual(['choice', 'text'])
    expect(S.server.def.steps[1]).toMatchObject({ validate: 'date', id: expect.stringMatching(/^q_/) })
  })
})

// ── Editing ──────────────────────────────────────────────────────────────────

describe('editing a question', () => {
  it('the preview shows the edit immediately, as WhatsApp will (numbered options, icon after the name)', () => {
    mount(start(emptyQuestionnaire('סלון דנה')))
    fireEvent.change(within(card(1)).getByLabelText('נוסח השאלה'), { target: { value: 'איזה טיפול?' } })
    fireEvent.change(within(card(1)).getByLabelText('שם האפשרות 1'), { target: { value: 'חתונה' } })
    // The icon is chosen from a small palette, not typed into a bare box.
    fireEvent.click(within(card(1)).getByRole('button', { name: /^הוספת אייקון לתשובה חתונה$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'בחירת האייקון 💍' }))
    expect(within(preview()).getByText(/איזה טיפול\?/).textContent).toContain('1. חתונה 💍')
  })

  it('natural phrasings live under "איך עוד לקוחות עשויים לכתוב את זה?", separate from the name', async () => {
    mount(start(emptyQuestionnaire('x')))
    const c1 = card(1)
    fireEvent.change(within(c1).getByLabelText('שם האפשרות 1'), { target: { value: 'חתונה' } })
    const add = within(c1).getByLabelText('ניסוח נוסף עבור חתונה')
    fireEvent.change(add, { target: { value: 'אנחנו מתחתנים' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(within(c1).getByRole('button', { name: 'הסרת הניסוח אנחנו מתחתנים' })).toBeTruthy()
    expect(screen.queryByText(/alias/i)).toBeNull()
    await saved()
    expect(S.server.def.steps[0].type === 'choice' && S.server.def.steps[0].options[0]).toMatchObject({
      label: 'חתונה',
      aliases: ['אנחנו מתחתנים'],
    })
  })

  it('switching type: choice → free text asks first when other questions depend on it', () => {
    mount(start(pp))
    fireEvent.change(within(card(1)).getByLabelText('סוג התשובה'), { target: { value: 'free' } })
    expect(screen.getByRole('dialog').textContent).toContain('האפשרויות שלה יימחקו')
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(within(card(1)).getByLabelText('שם האפשרות 1')).toBeTruthy()
  })

  it('"אחר": one switch adds the option and its follow-up; the follow-up is asked only after it', async () => {
    mount(start(emptyQuestionnaire('x')))
    const c1 = card(1)
    fireEvent.change(within(c1).getByLabelText('שם האפשרות 1'), { target: { value: 'תספורת' } })
    fireEvent.change(within(c1).getByLabelText('שם האפשרות 2'), { target: { value: 'צבע' } })
    fireEvent.click(within(c1).getByLabelText('אפשר ללקוח לבחור "אחר"'))
    // Said in words, with a way to the follow-up; never a second copy of its text to edit.
    expect(c1.textContent).toContain('כשלקוח בוחר "אחר", נשאל אותו גם: "בשמחה, ספרו לנו בקצרה במה מדובר."')
    expect(within(c1).queryByRole('textbox', { name: /מה נשאל/ })).toBeNull()
    expect(within(c1).getByRole('button', { name: 'עריכת שאלת ההמשך (שאלה 2)' })).toBeTruthy()
    expect(card(2).textContent).toContain('השאלה תופיע כאשר: הלקוח בחר אחר בשאלה "במה נוכל לעזור"')
    expect(card(2).className).toContain('ms-8')
    await saved()
    const [first, followUp] = S.server.def.steps
    const otherId = first.type === 'choice' ? first.options[2].id : ''
    expect(otherId).toMatch(/^o_/)
    expect(followUp.when).toEqual({ step: first.id, anyOf: [otherId] })
  })

  it('free-text checks in product words: date, "not decided", location preset, and the not-understood message', () => {
    mount(start(emptyQuestionnaire('x')))
    fireEvent.change(within(card(1)).getByLabelText('סוג התשובה'), { target: { value: 'free' } })
    const check = within(card(1)).getByLabelText('בדיקת התשובה') as HTMLSelectElement
    expect([...check.options].map((o) => o.text)).toEqual(['ללא בדיקה מיוחדת', 'תאריך', 'תשובה משמעותית', 'מיקום / מקום'])
    fireEvent.change(check, { target: { value: 'location' } })
    expect((within(card(1)).getByLabelText('אפשר לענות "עדיין לא נקבע"') as HTMLInputElement).checked).toBe(true)
    // The preset's message is set but folded away; it opens on request.
    expect(within(card(1)).queryByLabelText('כשלא הבנו את התשובה')).toBeNull()
    const more = within(card(1)).getByRole('button', { name: /מה נשלח כשהתשובה לא ברורה\?/ })
    expect(more.textContent).toContain('(הוגדר נוסח משלכם)')
    fireEvent.click(more)
    expect((within(card(1)).getByLabelText('כשלא הבנו את התשובה') as HTMLTextAreaElement).value).toContain('מיקום')
    expect(check.value).toBe('location')
  })

  it('branching is a sentence; never "when", ids or JSON', () => {
    mount(start(emptyQuestionnaire('x')))
    fireEvent.change(within(card(1)).getByLabelText('שם האפשרות 1'), { target: { value: 'חתונה' } })
    fireEvent.change(within(card(1)).getByLabelText('שם האפשרות 2'), { target: { value: 'שיער' } })
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה' }))
    // A business that never branches sees one quiet line; one click goes straight to "which answers?".
    expect(card(2).textContent).toContain('מופיעה תמיד.')
    expect(within(card(2)).queryByRole('combobox', { name: 'לפי התשובה לשאלה' })).toBeNull()
    fireEvent.click(within(card(2)).getByRole('button', { name: 'להציג רק לפי תשובה קודמת' }))
    fireEvent.click(within(card(2)).getByRole('checkbox', { name: 'חתונה' }))
    // Still open after the first tick, so a second answer can be added.
    fireEvent.click(within(card(2)).getByRole('checkbox', { name: 'שיער' }))
    fireEvent.click(within(card(2)).getByRole('button', { name: 'סיום' }))
    expect(card(2).textContent).toContain('השאלה תופיע כאשר: הלקוח בחר חתונה או שיער בשאלה "במה נוכל לעזור"')
    expect(document.body.textContent).not.toMatch(/\bwhen\b|anyOf|request_type|option_1/)
  })

  it('reordering: named up/down buttons, disabled at the ends, announced', () => {
    mount(start(pilot))
    const up = within(card(1)).getByRole('button', { name: /העברת השאלה "תחום העסק" למעלה/ }) as HTMLButtonElement
    expect(up.disabled).toBe(true)
    fireEvent.click(within(card(1)).getByRole('button', { name: /העברת השאלה "תחום העסק" למטה/ }))
    expect(card(2).textContent).toContain('תחום העסק')
    expect(screen.getByText('השאלה "תחום העסק" הועברה למקום 2')).toBeTruthy()
    const down = within(card(6)).getByRole('button', { name: /למטה/ }) as HTMLButtonElement
    expect(down.disabled).toBe(true)
  })

  it('deleting a question asks first and names what else changes', () => {
    mount(start(pp))
    fireEvent.click(within(card(1)).getByRole('button', { name: /מחיקת השאלה/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('למחוק את השאלה "סוג האירוע / השירות"?')
    expect(dialog.textContent).toMatch(/שאלות מופיעות לפי התשובה הזו/)
    expect(dialog.textContent).toMatch(/סיומים שונים/)
  })
})

// ── Endings ──────────────────────────────────────────────────────────────────

describe('endings', () => {
  it('the standard ending is one field; "סיום שונה לפי תשובה" says when, in words, and shows in the preview', () => {
    mount(start(pp))
    expect((screen.getByLabelText('הודעת הסיום') as HTMLTextAreaElement).value).toContain('צוות Perfect Picture')
    const custom = screen.getAllByText(/^סיום שונה \d$/)
    expect(custom).toHaveLength(3)
    expect(document.body.textContent).toContain('נשלח כאשר: הלקוח בחר חתונה בשאלה "סוג האירוע / השירות"')
    expect(document.body.textContent).toContain('נבדק מלמעלה למטה')
    fireEvent.focus(screen.getAllByLabelText('ההודעה')[2])
    expect(within(preview()).getByText(/wisepage\.wwcrm\.co\.il\/picture-perfect/)).toBeTruthy()
  })

  it('a new conditional ending with no answer ticked is pointed out until one is', () => {
    mount(start(pilot))
    const add = screen.getByRole('button', { name: 'הוספת סיום שונה לפי תשובה' })
    fireEvent.click(add)
    fireEvent.focusOut(add, { relatedTarget: null })
    expect(screen.getByText('בסיום השונה צריך לבחור לפחות תשובה אחת שאחריה הוא נשלח.')).toBeTruthy()
  })
})

// ── Real questionnaires ──────────────────────────────────────────────────────

describe('real questionnaires load as they are', () => {
  it('Perfect Picture (158): every capability is on screen, nothing to fix, nothing saved on load', async () => {
    mount(start(pp, [pp, pp, pp, pp]), 4)
    expect(screen.getAllByRole('article')).toHaveLength(10)
    const c1 = card(1)
    expect((within(c1).getByLabelText('אפשר ללקוח לבחור "אחר"') as HTMLInputElement).checked).toBe(true)
    expect(within(c1).getByRole('button', { name: 'אייקון לתשובה חתונה: 💍. שינוי' })).toBeTruthy()
    const phrasings = within(c1).getAllByText('איך עוד לקוחות עשויים לכתוב את זה?', { exact: false })[0].closest('details')!
    expect(phrasings.open).toBe(false)
    expect(phrasings.textContent).toContain('(6)')
    expect(within(phrasings).getByRole('button', { name: 'הסרת הניסוח מתחתנים' })).toBeTruthy()
    const location = screen.getByRole('article', { name: /· מיקום האירוע$/ })
    expect((within(location).getByLabelText('בדיקת התשובה') as HTMLSelectElement).value).toBe('location')
    const service = screen.getByRole('article', { name: /· שירות צילום$/ })
    expect((within(service).getByLabelText('סוג התשובה') as HTMLSelectElement).value).toBe('multi')
    expect(screen.getAllByText(/^סיום שונה \d$/)).toHaveLength(3)
    expect(document.body.textContent).toContain('השאלה תופיע כאשר: הלקוח בחר צילום רחפן / נדל״ן בשאלה "סוג האירוע / השירות"')
    // Conditional questions are indented under the route they belong to; no condition editor is open by default.
    expect(screen.getByRole('article', { name: /· אישור הטסה$/ }).className).toContain('ms-8')
    expect(screen.queryAllByRole('combobox', { name: 'לפי התשובה לשאלה' })).toHaveLength(0)
    expect(screen.queryByText(/חסר טקסט|יש בעיה/)).toBeNull()
    await new Promise((r) => setTimeout(r, 1000))
    expect(A.save).not.toHaveBeenCalled()
  })

  it('agency 103: loads without normalization or recreation; nothing is saved on load', async () => {
    mount(start(pilot, [pilot]), 1)
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(screen.queryByText(/חסר טקסט|יש בעיה/)).toBeNull()
    await new Promise((r) => setTimeout(r, 1000))
    expect(A.save).not.toHaveBeenCalled()
  })
})

// ── Saving and conflicts ─────────────────────────────────────────────────────

describe('saving', () => {
  it('autosaves serially with the version it was given, and says so lightly', async () => {
    mount(start(pilot, [pilot]), 1)
    fireEvent.change(screen.getByLabelText('הודעת הפתיחה'), { target: { value: 'שלום!' } })
    await saved()
    fireEvent.change(screen.getByLabelText('הודעת הפתיחה'), { target: { value: 'שלום שוב!' } })
    await waitFor(() => expect(S.calls).toEqual(['save:v1', 'save:v2']), { timeout: 3000 })
    expect(S.server.def.welcome).toBe('שלום שוב!')
  })

  it('a version conflict stops autosave and never overwrites the other tab', async () => {
    S.conflictNextSave = true
    mount(start(pilot, [pilot]), 1)
    fireEvent.change(screen.getByLabelText('הודעת הפתיחה'), { target: { value: 'from tab B' } })
    const alert = await screen.findByText(/הטיוטה השתנתה בחלון או במכשיר אחר/, undefined, { timeout: 3000 })
    expect(alert).toBeTruthy()
    expect(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeTruthy()
    S.conflictNextSave = false
    await new Promise((r) => setTimeout(r, 1000))
    expect(S.calls).toEqual(['save:v1'])
    expect(S.server.def.welcome).toBe(pilot.welcome)
  })
})

// ── Publish ──────────────────────────────────────────────────────────────────

describe('publishing', () => {
  it('runs the server check, confirms the revision number and pinning, publishes, and reopens a draft', async () => {
    mount(start(pilot, [pilot]), 1)
    fireEvent.change(screen.getByLabelText('הודעת הפתיחה'), { target: { value: 'פתיחה חדשה' } })
    fireEvent.click(screen.getByRole('button', { name: 'פרסום' }))
    const dialog = await screen.findByRole('dialog')
    expect(A.check).toHaveBeenCalled()
    expect(dialog.textContent).toContain('לפרסם את השאלון כגרסה 2?')
    expect(dialog.textContent).toContain('שיחות שכבר התחילו ימשיכו בגרסה שבה התחילו')
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'פרסום גרסה 2' })))
    await waitFor(() => expect(A.toast).toHaveBeenCalledWith('success', 'גרסה 2 פורסמה'))
    expect(S.server.published[1].welcome).toBe('פתיחה חדשה')
    expect(S.calls).toContain('open')
    expect(screen.getByText('גרסה 2 עונה לפניות חדשות בוואטסאפ.')).toBeTruthy()
  })

  it('a questionnaire that is not ready is not published; the problems are listed in Hebrew', async () => {
    mount(start(emptyQuestionnaire('x')))
    fireEvent.click(screen.getByRole('button', { name: 'פרסום' }))
    const alert = await screen.findByText('לפני הפרסום צריך לתקן כמה דברים בשאלון. הם מסומנים למטה.')
    expect(alert.parentElement?.textContent).toMatch(/יש אפשרות בלי שם/)
    // Every problem is now shown on its card, and the list leads there.
    expect(within(card(1)).getAllByText('כתבו שם לאפשרות.')).toHaveLength(2)
    fireEvent.click(within(alert.parentElement as HTMLElement).getAllByRole('button', { name: 'מעבר לשאלה' })[0])
    expect(document.activeElement).toBe(within(card(1)).getByLabelText('שם האפשרות 1'))
    expect(A.publish).not.toHaveBeenCalled()
  })
})

// ── History ──────────────────────────────────────────────────────────────────

describe('revision history', () => {
  it('lists only the real revisions, marks the live one, and restores into a draft after confirmation', async () => {
    const v1 = { ...pilot, welcome: 'גרסה ראשונה' }
    mount(start(pilot, [v1, pilot]), 2)
    fireEvent.click(screen.getByRole('button', { name: 'היסטוריית גרסאות' }))
    const dialog = await screen.findByRole('dialog', { name: 'היסטוריית הגרסאות' })
    await within(dialog).findByText('גרסה 2')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
    expect(within(dialog).getByText('פעילה בוואטסאפ')).toBeTruthy()
    expect(within(dialog).getByText(/דנה כהן/)).toBeTruthy()
    expect(within(dialog).getByText(/הגרסה שהייתה פעילה כשהתחלנו לשמור היסטוריה/)).toBeTruthy()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'יצירת טיוטה מגרסה זו' })[1])
    const confirm = await screen.findByRole('dialog', { name: /ליצור טיוטה מגרסה 1\?/ })
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'יצירת טיוטה מגרסה 1' })))
    await waitFor(() => expect((screen.getByLabelText('הודעת הפתיחה') as HTMLTextAreaElement).value).toBe('גרסה ראשונה'))
    expect(S.calls).toEqual(['discard:v1', 'open:1'])
    // Restoring publishes nothing: the history is untouched.
    expect(S.server.published).toHaveLength(2)
  })
})

// ── Simulator ────────────────────────────────────────────────────────────────

describe('בדיקת השאלון', () => {
  it('runs the real simulate path on the draft, shows the chat, keeps "why" collapsed', async () => {
    mount(start(pp, [pp]), 1)
    fireEvent.click(screen.getByRole('button', { name: 'בדיקת השאלון' }))
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'היי' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(A.simulate).toHaveBeenCalledWith({ draftId: 1, turns: [['היי']] }))
    const log = screen.getByRole('log', { name: 'שיחת הבדיקה' })
    await within(log).findByText(/ברוכים הבאים ל־Perfect Picture/)
    fireEvent.change(input, { target: { value: 'אנחנו מתחתנים' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(A.simulate).toHaveBeenLastCalledWith({ draftId: 1, turns: [['היי'], ['אנחנו מתחתנים']] }))
    await within(log).findByText(/המון מזל טוב/)
    const why = within(log).getAllByText('למה המערכת בחרה בזה?')[1].closest('details')!
    expect(why.open).toBe(false)
    expect(why.textContent).toContain('סוג האירוע / השירות: חתונה (זוהה מתוך: "אנחנו מתחתנים")')
    expect(screen.getAllByText(/זו סימולציה\. לא נשלחת הודעה בוואטסאפ/).length).toBeGreaterThan(0)
  })
})

// ── Accessibility ────────────────────────────────────────────────────────────

describe('accessibility', () => {
  it('every control has a name, and nothing in the chrome is an emoji', () => {
    mount(start(pp, [pp]), 1)
    for (const role of ['textbox', 'combobox', 'checkbox', 'radio', 'button'] as const) {
      for (const el of screen.queryAllByRole(role)) {
        const named =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          (el as HTMLInputElement).labels?.length ||
          el.textContent?.trim()
        expect(named, `${role} without a name: ${el.outerHTML.slice(0, 120)}`).toBeTruthy()
      }
    }
    // An answer's chosen icon (the owner's content) is shown on its icon button; that is not chrome.
    const chrome = [...document.querySelectorAll('h1,h2,h3,h4,legend,label,button:not([aria-label^="אייקון לתשובה"]),summary')]
      .map((e) => e.textContent ?? '')
      .join(' ')
    // Option labels quoted in names are user content; strip quoted text before checking.
    expect(chrome.replace(/"[^"]*"/g, '')).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

// ── Review fixes (PR2 UX review) ─────────────────────────────────────────────

describe('an unavailable control says why, to everyone', () => {
  it('is focusable, announced as unavailable, described by its reason, and shows the reason when used', () => {
    mount(start(emptyQuestionnaire('x')))
    const remove = within(card(1)).getByRole('button', { name: /מחיקת האפשרות אפשרות 1/ })
    // Not `disabled` (a disabled button cannot take keyboard focus) and no hover-only title.
    expect((remove as HTMLButtonElement).disabled).toBe(false)
    expect(remove.getAttribute('title')).toBeNull()
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    const why = document.getElementById(remove.getAttribute('aria-describedby') as string)!
    expect(why.textContent).toBe('בשאלת בחירה צריכות להיות לפחות שתי אפשרויות.')
    expect(why.className).toContain('sr-only')
    remove.focus()
    expect(document.activeElement).toBe(remove)
    fireEvent.click(remove)
    expect(why.className).not.toContain('sr-only')
    expect(optionsOf(S.server.def)).toHaveLength(2) // nothing removed
  })

  it('no control in the Builder explains itself with a hover-only title', () => {
    mount(start(pp, [pp]), 1)
    expect(document.querySelectorAll('main [title], [role="article"] [title], article [title]').length).toBe(0)
  })
})

describe('publishing is honest about whether customers get it', () => {
  it('when WhatsApp is not answering with the questionnaire, the confirmation says so', async () => {
    render(
      <QuestionnaireBuilder
        initialDraft={start(pilot, [pilot])}
        liveRevision={1}
        routing={{ routedToQuestionnaire: false, channelEnabled: true, masterEnabled: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'פרסום' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('השאלון עדיין לא מופעל בוואטסאפ, ולכן לקוחות לא יקבלו אותו עד שיופעל.')
    expect(dialog.textContent).not.toContain('שיחות חדשות יקבלו')
  })
})

describe('typing is never interrupted by autosave', () => {
  it('a new question keeps its DOM (and the cursor) when its save assigns server ids', async () => {
    mount(start(pilot, [pilot]), 1)
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה' }))
    const box = within(card(7)).getByLabelText('נוסח השאלה')
    box.focus()
    fireEvent.change(box, { target: { value: 'מה התקציב?' } })
    await saved()
    expect(S.server.def.steps[6].id).toMatch(/^q_/)
    expect(within(card(7)).getByLabelText('נוסח השאלה')).toBe(box)
    expect(document.activeElement).toBe(box)
  })
})

describe('branching stays out of the way', () => {
  it('a question with nothing before it to depend on shows no branching control at all', () => {
    mount(start(emptyQuestionnaire('x')))
    expect(card(1).textContent).not.toContain('מופיעה תמיד')
    expect(within(card(1)).queryByRole('button', { name: 'להציג רק לפי תשובה קודמת' })).toBeNull()
  })
})

function optionsOf(def: QuestionnaireDefinition) {
  const step = def.steps[0]
  return step.type === 'choice' ? step.options : []
}
