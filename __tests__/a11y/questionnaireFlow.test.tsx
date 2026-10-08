// @vitest-environment jsdom
//
// The Flow view prototype (QUESTIONNAIRE_FLOW_EDITOR): the conversation as a
// map over the SAME draft the Conversation view edits. React Flow measures
// boxes in the browser; jsdom is given sizes the way React Flow's own testing
// guide does (ResizeObserver, offset sizes, DOMMatrixReadOnly).

import fs from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const SIM = vi.hoisted(() => ({ simulate: vi.fn() }))
vi.mock('@/actions/questionnaire/builderPublish', () => ({ simulateQuestionnaireDraft: SIM.simulate, listQuestionnaireRevisions: vi.fn() }))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))

import FlowWorkspace from '@/components/settings/questionnaire/flow/FlowWorkspace'
import QuestionnaireSimulator from '@/components/settings/questionnaire/QuestionnaireSimulator'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import ConversationWorkspace from '@/components/settings/questionnaire/ConversationWorkspace'
import { applyTextCheck } from '@/components/settings/questionnaire/answerCheck'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
import { addPhrasing, adoptIds, conditionOf, keyOf, optionsOf, setPrompt, updateOption } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

beforeAll(() => {
  class RO {
    constructor(private cb: (entries: Array<{ target: Element }>) => void) {}
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 1200, height: 800 } } as never])
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as never
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 300 },
    offsetHeight: { configurable: true, get: () => 200 },
  })
  ;(globalThis as Record<string, unknown>).DOMMatrixReadOnly = class {
    m22 = 1
  }
})
afterEach(cleanup)

const pp = toBuilder(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8')))

/** A stand-in for the Builder: one draft, edited by whichever view is shown. */
let latest: BuilderQuestionnaire
let setLatest: (m: BuilderQuestionnaire) => void = () => {}
function Harness({ initial, view: start = 'flow' }: { initial: BuilderQuestionnaire; view?: 'flow' | 'conversation' }) {
  const [model, setModel] = useState(initial)
  const [mode, setMode] = useState(start)
  latest = model
  setLatest = setModel
  const edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => setModel((m) => change(m))
  const common = { model, view: deriveEditorView(model), edit, confirm: (r: { run: () => void }) => r.run(), announce: () => {}, draftId: 1, flush: async () => true, onNotReady: () => {} }
  return (
    <div>
      <button onClick={() => setMode(mode === 'flow' ? 'conversation' : 'flow')}>החלפת תצוגה</button>
      {mode === 'flow' ? (
        <FlowWorkspace {...common} issuesFor={() => []} leave={() => {}} panel='none' setPanel={() => {}} openConversation={() => setMode('conversation')} />
      ) : (
        <ConversationWorkspace {...common} canEdit revealAll={false} touched={new Set()} touch={() => {}} testing={false} stopTesting={() => {}} />
      )}
    </div>
  )
}

const box = (n: number) => document.querySelector(`.react-flow__node[data-id]:has(button[aria-label^="עריכת שאלה ${n}"])`) as HTMLElement

describe('the map', () => {
  it('opens on the existing conversation: opening, every question, one endings box; nothing to draw by hand', async () => {
    render(<Harness initial={pp} />)
    await act(async () => {})
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(12)
    expect(screen.getByText('לקוח שולח הודעה ומקבל:')).toBeTruthy()
    expect(screen.getByText('בסוף השיחה הלקוח מקבל:')).toBeTruthy()
    // Boxes read like WhatsApp: numbered answers with their icons.
    expect(within(box(1)).getByText(/1\. חתונה/).textContent).toContain('💍')
    // Conditional endings are sentences, not more boxes.
    expect(screen.getByText(/^אם הלקוח בחר חתונה:/)).toBeTruthy()
    // No connection dragging: handles are not connectable.
    expect(document.querySelectorAll('.react-flow__handle.connectable').length).toBe(0)
  })

  it('a follow-up question says who is asked, in words', async () => {
    render(<Harness initial={pp} />)
    await act(async () => {})
    expect(within(box(9)).getByText(/נשאלת רק מי שבחר/).textContent).toContain('צילום רחפן / נדל״ן')
    expect(document.body.textContent).not.toMatch(/\bwhen\b|anyOf|event_type|drone_city/)
  })
})

describe('building on the map', () => {
  it('"+ הוספת שאלה" → choose how they answer → the question is added, connected and open for writing', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /תשובה חופשית/ }))
    await act(async () => {})
    expect(latest.questions).toHaveLength(2)
    expect(latest.questions[1].answer.kind).toBe('text')
    const editor = screen.getByLabelText('מה נשאל את הלקוח')
    fireEvent.change(editor, { target: { value: 'איזה תאריך נוח לך?' } })
    expect(latest.questions[1].prompt).toBe('איזה תאריך נוח לך?')
    expect(document.querySelectorAll('.react-flow__edge').length).toBe(3) // opening→q1→q2→endings
  })

  it('"+ שאלת המשך" on one answer asks it only of that answer, right after, and opens it (not the question it came from)', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    fireEvent.click(within(box(1)).getByRole('button', { name: /עריכת שאלה 1/ }))
    fireEvent.change(screen.getByLabelText('תשובה 1', { selector: 'input' }), { target: { value: 'איפור' } })
    fireEvent.click(screen.getAllByRole('button', { name: '+ שאלת המשך אם בוחרים בזה' })[0])
    await act(async () => {})
    const follow = latest.questions[1]
    expect(conditionOf(follow)).toEqual({ questionId: keyOf(latest.questions[0]), anyOf: [keyOf(latest.questions[0].answer.kind === 'single_choice' ? latest.questions[0].answer.options[0] : ({} as never))] })
    fireEvent.change(screen.getByLabelText('מה נשאל את הלקוח'), { target: { value: 'לאיזה אירוע?' } })
    expect(latest.questions[1].prompt).toBe('לאיזה אירוע?')
    expect(latest.questions[0].prompt).toBe('במה נוכל לעזור?')
    expect(document.querySelectorAll('.react-flow__edge').length).toBe(4)
  })

  it('both views edit one draft: a change on the map is the change in the conversation, and back', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    fireEvent.click(within(box(1)).getByRole('button', { name: /עריכת שאלה 1/ }))
    fireEvent.change(screen.getByLabelText('מה נשאל את הלקוח'), { target: { value: 'איזה טיפול?' } })
    fireEvent.click(screen.getByRole('button', { name: 'החלפת תצוגה' }))
    const card = screen.getByRole('article', { name: /^שאלה 1/ })
    expect((within(card).getByLabelText('נוסח השאלה') as HTMLTextAreaElement).value).toBe('איזה טיפול?')
    fireEvent.change(within(card).getByLabelText('נוסח השאלה'), { target: { value: 'איזה טיפול מעניין אותך?' } })
    fireEvent.click(screen.getByRole('button', { name: 'החלפת תצוגה' }))
    await act(async () => {})
    expect(within(box(1)).getByText('איזה טיפול מעניין אותך?')).toBeTruthy()
  })
})

describe('answer type in product words', () => {
  it('"תאריך" also accepts "not decided yet", which its message invites', () => {
    const m = applyTextCheck(toBuilder(emptyQuestionnaire('x')), 'request_type', 'date')
    expect(m.questions[0].answer).toEqual({ kind: 'date', notSetAllowed: true })
    expect(m.questions[0].messages.notUnderstood).toContain('לא נקבע')
  })
})

// ── Polish pass ──────────────────────────────────────────────────────────────

const open1 = () => fireEvent.click(within(box(1)).getByRole('button', { name: /עריכת שאלה 1/ }))

describe('polish: building feels obvious', () => {
  it('boxes cannot be dragged: position never looks like reordering', async () => {
    render(<Harness initial={pp} />)
    await act(async () => {})
    expect(document.querySelectorAll('.react-flow__node.draggable')).toHaveLength(0)
  })

  it('"+ שאלת המשך" puts the cursor straight into the new question', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    open1()
    fireEvent.click(screen.getAllByRole('button', { name: '+ שאלת המשך אם בוחרים בזה' })[0])
    await act(async () => {})
    expect(document.activeElement).toBe(screen.getByLabelText('מה נשאל את הלקוח'))
    expect(screen.getByText(/נשאלת רק מי שבחר/)).toBeTruthy()
  })

  it('an icon is chosen from a small palette, and can be removed', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    open1()
    fireEvent.change(screen.getByLabelText('תשובה 1', { selector: 'input' }), { target: { value: 'איפור' } })
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אייקון לתשובה איפור' }))
    const palette = screen.getByRole('dialog', { name: 'אייקון לתשובה איפור' })
    fireEvent.click(within(palette).getByRole('button', { name: 'בחירת האייקון 💄' }))
    expect(optionsOf(latest.questions[0])[0].icon).toBe('💄')
    fireEvent.click(screen.getByRole('button', { name: 'אייקון לתשובה איפור: 💄. שינוי' }))
    fireEvent.click(screen.getByRole('button', { name: 'ללא אייקון' }))
    expect(optionsOf(latest.questions[0])[0]).not.toHaveProperty('icon')
  })

  it('customer phrases are offered right under the answer, without engine words', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    open1()
    fireEvent.change(screen.getByLabelText('תשובה 1', { selector: 'input' }), { target: { value: 'איפור' } })
    fireEvent.click(screen.getAllByText('+ איך לקוחות יכולים לנסח את זה?')[0])
    const field = screen.getByLabelText('ניסוח נוסף עבור איפור', { exact: true })
    fireEvent.change(field, { target: { value: 'אני רוצה איפור' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(optionsOf(latest.questions[0])[0].phrasings).toEqual(['אני רוצה איפור'])
    expect(document.body.textContent).not.toMatch(/alias/i)
  })

  it('"אחר": on → who is asked what, in words; off → asks first, then removes both', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    open1()
    fireEvent.click(screen.getByLabelText('אפשר לבחור "אחר"'))
    expect(screen.getByText(/מי שבוחר "אחר" יישאל: "בשמחה, ספרו לנו בקצרה במה מדובר\."/)).toBeTruthy()
    expect(latest.questions).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('אפשר לבחור "אחר"')) // the harness confirms immediately
    expect(latest.questions).toHaveLength(1)
    expect(optionsOf(latest.questions[0]).map((o) => o.label)).not.toContain('אחר')
  })

  it('special endings are edited on the map, headed in words, without conditions', async () => {
    render(<Harness initial={pp} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'עריכת הודעות הסיום' }))
    const wedding = screen.getByLabelText('אם הלקוח בחר חתונה')
    fireEvent.change(wedding, { target: { value: 'מזל טוב! הנה החבילות שלנו' } })
    expect(latest.endings.custom[2].message).toBe('מזל טוב! הנה החבילות שלנו')
    expect(latest.endings.custom[2].sentWhen).toEqual(pp.endings.custom[2].sentWhen)
    expect(screen.getByLabelText('סיום רגיל')).toBeTruthy()
    expect(screen.getByRole('button', { name: /שינוי מי מקבל כל סיום/ })).toBeTruthy()
  })

  it('keyboard: the add menu opens on its first choice and closes with Escape', async () => {
    render(<Harness initial={pp} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' }))
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    // Box wrappers are not Tab stops; their own controls are.
    expect(document.querySelectorAll('.react-flow__node[tabindex="0"]')).toHaveLength(0)
    // React Flow's own control names are in Hebrew.
    expect(screen.getByRole('button', { name: 'הצגת כל התרשים' })).toBeTruthy()
  })
})

describe('polish: the test chat teaches phrases', () => {
  function salon(): BuilderQuestionnaire {
    let m = toBuilder(emptyQuestionnaire('סלון'))
    m = setPrompt(m, 'request_type', 'איזה שירות?')
    m = updateOption(m, 'request_type', 'option_1', { label: 'איפור' })
    return updateOption(m, 'request_type', 'option_2', { label: 'שיער' })
  }

  it('an unrecognised sentence naming one answer gets an owner-only offer; one click teaches it', async () => {
    const m = salon()
    SIM.simulate.mockImplementation(async ({ turns }: { turns: string[][] }) => ({ ok: true, ...simulateConversation(previewDefinition(m)!, turns) }))
    const onTeach = vi.fn()
    render(<QuestionnaireSimulator model={m} target={{ draftId: 1 }} onTeach={onTeach} />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    for (const t of ['היי', 'אני רוצה איפור']) {
      fireEvent.change(input, { target: { value: t } })
      await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    }
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('ללמד אותו ש"אני רוצה איפור" זה "איפור"?')
    // Outside the WhatsApp bubbles: the customer never sees it.
    expect(note.closest('p[dir="rtl"]')).toBeNull()
    fireEvent.click(within(note).getByRole('button', { name: 'הוספה לניסוחים של "איפור"' }))
    expect(onTeach).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'request_type', optionId: 'option_1', phrase: 'אני רוצה איפור' }))
    expect(screen.getByText(/נוסף לניסוחים של "איפור"/)).toBeTruthy()
  })

  it('when nothing can be suggested safely, it says where phrases are taught instead', async () => {
    const m = salon()
    SIM.simulate.mockImplementation(async ({ turns }: { turns: string[][] }) => ({ ok: true, ...simulateConversation(previewDefinition(m)!, turns) }))
    render(<QuestionnaireSimulator model={m} target={{ draftId: 1 }} onTeach={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    for (const t of ['היי', 'בננה']) {
      fireEvent.change(input, { target: { value: t } })
      await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    }
    expect(screen.getByRole('note').textContent).toContain('תחת "איך לקוחות יכולים לנסח את זה?"')
    expect(addPhrasing).toBeTypeOf('function')
  })
})

describe('polish: autosave never takes the cursor away', () => {
  it('when a save gives the new question its server id, the open box keeps the same field and the cursor', async () => {
    render(<Harness initial={toBuilder(emptyQuestionnaire('סלון'))} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /תשובה חופשית/ }))
    await act(async () => {})
    const field = screen.getByLabelText('מה נשאל את הלקוח')
    expect(document.activeElement).toBe(field)
    const ref = latest.questions[1].ref as string
    await act(async () => setLatest(adoptIds(latest, { [ref]: 'q_server01' })))
    await act(async () => {})
    expect(latest.questions[1].id).toBe('q_server01')
    expect(screen.getByLabelText('מה נשאל את הלקוח')).toBe(field)
    expect(document.activeElement).toBe(field)
  })
})
