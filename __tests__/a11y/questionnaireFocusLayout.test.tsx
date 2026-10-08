// @vitest-environment jsdom
//
// Flow Builder hardening after production acceptance (agency 103):
//   1. the test chat keeps the cursor in the message box after every reply;
//   2. deleting a question, removing a customer phrase and dismissing the
//      add-question menu never drop the cursor to the page;
//   3. a follow-up is laid out next to the question that asks it, not beside
//      the ending.
// Each test here fails on the code that shipped in 3c0664dc.

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
import PhrasingsEditor from '@/components/settings/questionnaire/PhrasingsEditor'
import { focusAfterRemoval, ADD_QUESTION } from '@/components/settings/questionnaire/flow/removalFocus'
import { layoutFlow } from '@/components/settings/questionnaire/flow/flowLayout'
import { buildFlow, ENDINGS, OPENING } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { previewDefinition, deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { addFollowUp, keyOf, reactKey } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
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

/** The shape of agency 103's questionnaire (wording neutral): two shared questions, two follow-ups that end the conversation. */
const supportShape = {
  schemaVersion: 1,
  revision: 1,
  language: 'he',
  welcome: 'היי',
  closing: 'תודה',
  handoff: 'מעבירים לנציג',
  summaryTitle: 'סיכום',
  expireAfterHours: 24,
  maxInvalidAttempts: 2,
  steps: [
    {
      id: 'q_kind',
      type: 'choice',
      label: 'סוג',
      prompt: 'במה נוכל לעזור?',
      options: [
        { id: 'o_learn', label: 'להכיר' },
        { id: 'o_price', label: 'מחיר' },
        { id: 'o_help', label: 'עזרה' },
        { id: 'o_other', label: 'אחר' },
      ],
    },
    { id: 'q_other', type: 'text', when: { step: 'q_kind', anyOf: ['o_other'] }, label: 'פירוט', prompt: 'ספרו בקצרה', validate: 'meaningful' },
    { id: 'q_field', type: 'text', when: { step: 'q_kind', anyOf: ['o_learn', 'o_price'] }, label: 'תחום', prompt: 'באיזה תחום?', validate: 'meaningful' },
    { id: 'q_team', type: 'text', when: { step: 'q_kind', anyOf: ['o_learn', 'o_price'] }, label: 'צוות', prompt: 'מי מטפל?', validate: 'meaningful' },
    { id: 'q_help', type: 'text', when: { step: 'q_kind', anyOf: ['o_help'] }, label: 'בעיה', prompt: 'מה קרה?', validate: 'meaningful' },
  ],
}
const support = () => toBuilder(supportShape as never)
const pp = () => toBuilder(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8')))

let latest: BuilderQuestionnaire
function Harness({ initial }: { initial: BuilderQuestionnaire }) {
  const [model, setModel] = useState(initial)
  latest = model
  return (
    <FlowWorkspace
      model={model}
      view={deriveEditorView(model)}
      edit={(change) => setModel((m) => change(m))}
      confirm={(r) => r.run()}
      announce={() => {}}
      issuesFor={() => []}
      leave={() => {}}
      panel='none'
      setPanel={() => {}}
      draftId={1}
      flush={async () => true}
      onNotReady={() => {}}
      openConversation={() => {}}
    />
  )
}
const frames = () => act(async () => new Promise((r) => setTimeout(r, 120)))
const editButton = (n: number) => screen.getByRole('button', { name: new RegExp(`^עריכת שאלה ${n}(:|$)`) })

describe('1. the test chat keeps the cursor in the message box', () => {
  const runOn = (m: BuilderQuestionnaire) =>
    SIM.simulate.mockImplementation(async ({ turns }: { turns: string[][] }) => ({ ok: true, ...simulateConversation(previewDefinition(m)!, turns) }))

  it('while a reply is checked the box stays usable (read-only, never disabled), and after it the cursor is back in it', async () => {
    const m = support()
    let release: () => void = () => {}
    SIM.simulate.mockImplementation(
      ({ turns }: { turns: string[][] }) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, ...simulateConversation(previewDefinition(m)!, turns) })
        }),
    )
    render(<QuestionnaireSimulator model={m} target={{ draftId: 1 }} autoFocus />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'היי' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(input.disabled).toBe(false)
    expect(input.readOnly).toBe(true)
    await act(async () => release())
    expect(input.readOnly).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('sent with the button: the cursor goes to the message box for the next reply', async () => {
    runOn(support())
    render(<QuestionnaireSimulator model={support()} target={{ draftId: 1 }} />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    fireEvent.change(input, { target: { value: 'היי' } })
    const sendButton = screen.getByRole('button', { name: 'שליחה' })
    sendButton.focus()
    await act(async () => fireEvent.click(sendButton))
    expect(document.activeElement).toBe(input)
  })

  it('a keyboard-only conversation to the end: type, Enter, type again; once it ends the cursor is on "שיחה חדשה"', async () => {
    runOn(support())
    render(<QuestionnaireSimulator model={support()} target={{ draftId: 1 }} autoFocus />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    for (const reply of ['היי', 'בננה', '3']) {
      expect(document.activeElement).toBe(input)
      fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: reply } })
      await act(async () => fireEvent.keyDown(document.activeElement as HTMLInputElement, { key: 'Enter' }))
    }
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'המערכת לא נטענת' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(screen.getByText('השאלון הסתיים. כך הנציג יקבל את הסיכום:')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'שיחה חדשה' }))
  })

  it('teaching a phrase removes its note; the cursor goes to the message box, not the page', async () => {
    const m = support()
    runOn(m)
    render(<QuestionnaireSimulator model={m} target={{ draftId: 1 }} onTeach={() => {}} autoFocus />)
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    for (const reply of ['היי', 'אני רוצה מחיר']) {
      fireEvent.change(input, { target: { value: reply } })
      await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    }
    const teach = within(screen.getByRole('note')).getByRole('button')
    teach.focus()
    await act(async () => fireEvent.click(teach))
    expect(document.activeElement).toBe(input)
  })

  it('never takes the cursor back from something the owner moved to while waiting', async () => {
    const m = support()
    let release: () => void = () => {}
    SIM.simulate.mockImplementation(
      ({ turns }: { turns: string[][] }) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, ...simulateConversation(previewDefinition(m)!, turns) })
        }),
    )
    render(
      <div>
        <button>elsewhere</button>
        <QuestionnaireSimulator model={m} target={{ draftId: 1 }} autoFocus />
      </div>,
    )
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    fireEvent.change(input, { target: { value: 'היי' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    screen.getByRole('button', { name: 'elsewhere' }).focus()
    await act(async () => release())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'elsewhere' }))
  })

  it('in the Flow drawer, Escape still closes the test and returns to the opener after a reply', async () => {
    const m = support()
    runOn(m)
    function Drawer() {
      const [panel, setPanel] = useState<'none' | 'test'>('none')
      return (
        <div>
          <button onClick={() => setPanel('test')}>פתיחת הבדיקה</button>
          <FlowWorkspace
            model={m}
            view={deriveEditorView(m)}
            edit={() => {}}
            confirm={() => {}}
            announce={() => {}}
            issuesFor={() => []}
            leave={() => {}}
            panel={panel}
            setPanel={(p) => setPanel(p as 'none' | 'test')}
            draftId={1}
            flush={async () => true}
            onNotReady={() => {}}
            openConversation={() => {}}
          />
        </div>
      )
    }
    render(<Drawer />)
    await act(async () => {})
    const opener = screen.getByRole('button', { name: 'פתיחת הבדיקה' })
    opener.focus()
    await act(async () => fireEvent.click(opener))
    const input = screen.getByRole('textbox', { name: 'הודעה כלקוח' })
    fireEvent.change(input, { target: { value: 'היי' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(document.activeElement).toBe(input)
    await act(async () => fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' }))
    await frames()
    expect(screen.queryByRole('textbox', { name: 'הודעה כלקוח' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('2. deleting, removing a phrase and dismissing the menu keep the cursor somewhere useful', () => {
  it('where the cursor goes after a deletion: the follow-up\'s question, else the one before, else after, else "+ הוספת שאלה"', () => {
    const m = support()
    const key = (id: string) => reactKey(m.questions.find((q) => keyOf(q) === id)!)
    expect(focusAfterRemoval(m, 'q_help')).toBe(key('q_kind'))
    expect(focusAfterRemoval(m, 'q_other')).toBe(key('q_kind'))
    expect(focusAfterRemoval(m, 'q_kind')).toBe(key('q_other'))
    const single = toBuilder({ ...supportShape, steps: [supportShape.steps[0]] } as never)
    expect(focusAfterRemoval(single, 'q_kind')).toBe(ADD_QUESTION)
    const plain = toBuilder({ ...supportShape, steps: supportShape.steps.map((s) => ({ ...s, when: undefined })) } as never)
    const plainKey = (id: string) => reactKey(plain.questions.find((q) => keyOf(q) === id)!)
    expect(focusAfterRemoval(plain, 'q_field')).toBe(plainKey('q_other'))
    expect(focusAfterRemoval(plain, 'q_kind')).toBe(plainKey('q_other'))
  })

  it('deleting a follow-up from its box puts the cursor on its question\'s "עריכה", never the page', async () => {
    render(<Harness initial={support()} />)
    await frames()
    fireEvent.click(editButton(5))
    await frames()
    fireEvent.click(screen.getByRole('button', { name: /^מחיקת השאלה/ }))
    await frames()
    expect(latest.questions.map(keyOf)).not.toContain('q_help')
    expect(document.activeElement).toBe(editButton(1))
  })

  it('deleting an ordinary question (cursor inside its editor) puts the cursor on the question before it', async () => {
    let m = support()
    m = addFollowUp(m, 'q_kind', 'o_learn', 'text', 'new_extra')
    m = { ...m, questions: m.questions.map((q) => (keyOf(q) === 'new_extra' ? { ...q, prompt: 'נוספת', shownWhen: { mode: 'always' as const } } : q)) }
    render(<Harness initial={m} />)
    await frames()
    fireEvent.click(editButton(2))
    await frames()
    screen.getByLabelText('מה נשאל את הלקוח').focus()
    fireEvent.click(screen.getByRole('button', { name: /^מחיקת השאלה/ }))
    await frames()
    expect(document.activeElement).toBe(editButton(1))
  })

  it('removing a phrase keeps the cursor in the phrases: on the next one, then the previous, then the box for a new one', async () => {
    function Phrases() {
      const [list, setList] = useState(['א', 'ב', 'ג'])
      return <PhrasingsEditor phrasings={list} onChange={setList} optionLabel='חתונה' />
    }
    render(<Phrases />)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת הניסוח ב' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'הסרת הניסוח ג' }))
    fireEvent.click(screen.getByRole('button', { name: 'הסרת הניסוח ג' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'הסרת הניסוח א' }))
    fireEvent.click(screen.getByRole('button', { name: 'הסרת הניסוח א' }))
    expect(document.activeElement).toBe(screen.getByLabelText('ניסוח נוסף עבור חתונה'))
  })

  it('Escape closes "+ הוספת שאלה" and returns the cursor to that button', async () => {
    render(<Harness initial={support()} />)
    await frames()
    const add = screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' })
    add.focus()
    fireEvent.click(add)
    await frames()
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    await frames()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(add)
  })
})

describe('3. a follow-up sits next to the question that asks it', () => {
  function layout(m: BuilderQuestionnaire) {
    const g = buildFlow(m)
    const ids = [OPENING, ...g.questions, ENDINGS]
    const pos = layoutFlow(ids, g.edges, {})
    const step = pos[g.questions[0]].y - pos[OPENING].y
    return { g, pos, step }
  }

  it("agency 103's shape: every answer's own route is one step long (was: the follow-ups sat beside the ending)", () => {
    const { g, pos, step } = layout(support())
    const answerRoutes = g.edges.filter((e) => e.option)
    expect(answerRoutes.map((e) => e.target).sort()).toEqual(['q_help', 'q_other'])
    for (const e of answerRoutes) expect(pos[e.target].y - pos[e.source].y).toBe(step)
    // The real routes are unchanged: both follow-ups still go straight to the ending.
    expect(g.edges.filter((e) => e.target === ENDINGS).map((e) => e.source).sort()).toEqual(['q_help', 'q_other', 'q_team'])
  })

  it('Perfect Picture: every route still flows downwards, and a branch with its own questions starts right under its question', () => {
    const { g, pos, step } = layout(pp())
    for (const e of g.edges) expect(pos[e.target].y).toBeGreaterThan(pos[e.source].y)
    const own = g.edges.filter((e) => e.option && g.edges.filter((x) => x.target === e.target).length === 1)
    expect(own.length).toBeGreaterThan(0)
    for (const e of own) expect(pos[e.target].y - pos[e.source].y).toBe(step)
  })

  it('layout never changes what the map says: the same edges with or without positions', () => {
    for (const m of [support(), pp()]) {
      const before = JSON.stringify(buildFlow(m))
      layout(m)
      expect(JSON.stringify(buildFlow(m))).toBe(before)
    }
  })
})
