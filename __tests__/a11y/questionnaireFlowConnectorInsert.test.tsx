// @vitest-environment jsdom
//
// "+ הוספת שאלה" on the map's continue arrows: the owner adds the next step
// where they are looking, not from a separate button. The question is inserted
// with insertQuestion (same model, same menu as every other way of adding),
// and every view shows the same result.

import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/actions/questionnaire/builderPublish', () => ({ simulateQuestionnaireDraft: vi.fn(), listQuestionnaireRevisions: vi.fn() }))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))

import FlowWorkspace from '@/components/settings/questionnaire/flow/FlowWorkspace'
import ConversationWorkspace from '@/components/settings/questionnaire/ConversationWorkspace'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { buildFlow } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { conditionOf, keyOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
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

const base = { schemaVersion: 1, revision: 1, language: 'he', welcome: 'היי', closing: 'תודה', handoff: 'נציג', summaryTitle: 'סיכום', expireAfterHours: 24, maxInvalidAttempts: 2 }
const text = (id: string, when?: { step: string; anyOf: string[] }) => ({ id, type: 'text', label: id, prompt: `${id}?`, validate: 'meaningful', ...(when ? { when } : {}) })
/** Opening → 1 → 2 → 3 → ending. */
const linear = () => toBuilder({ ...base, steps: [text('q_a'), text('q_b'), text('q_c')] } as never)
/** Agency 103's shape. */
const branching = () =>
  toBuilder({
    ...base,
    steps: [
      { id: 'q_kind', type: 'choice', label: 'סוג', prompt: 'במה נוכל לעזור?', options: [
        { id: 'o_learn', label: 'להכיר' }, { id: 'o_price', label: 'מחיר' }, { id: 'o_help', label: 'עזרה' }, { id: 'o_other', label: 'אחר' },
      ] },
      text('q_other', { step: 'q_kind', anyOf: ['o_other'] }),
      text('q_field', { step: 'q_kind', anyOf: ['o_learn', 'o_price'] }),
      text('q_help', { step: 'q_kind', anyOf: ['o_help'] }),
    ],
  } as never)
const empty = () => toBuilder({ ...base, welcome: '', closing: '', steps: [] } as never)

let latest: BuilderQuestionnaire
function Harness({ initial }: { initial: BuilderQuestionnaire }) {
  const [model, setModel] = useState(initial)
  const [view, setView] = useState<'flow' | 'list'>('flow')
  latest = model
  const common = { model, view: deriveEditorView(model), edit: (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => setModel((m) => change(m)), confirm: (r: { run: () => void }) => r.run(), announce: () => {}, draftId: 1, flush: async () => true, onNotReady: () => {} }
  return (
    <div>
      <button onClick={() => setView(view === 'flow' ? 'list' : 'flow')}>החלפת תצוגה</button>
      {view === 'flow' ? (
        <FlowWorkspace {...common} issuesFor={() => []} leave={() => {}} panel='none' setPanel={() => {}} openConversation={() => {}} />
      ) : (
        <ConversationWorkspace {...common} canEdit revealAll={false} touched={new Set()} touch={() => {}} testing={false} stopTesting={() => {}} />
      )}
    </div>
  )
}
const frames = () => act(async () => new Promise((r) => setTimeout(r, 120)))
const plusButtons = () => screen.queryAllByRole('button', { name: /^הוספת שאלה אחרי / })
const plus = (where: string) => screen.getByRole('button', { name: `הוספת שאלה אחרי ${where}` })
const choose = async (kind: RegExp) => {
  fireEvent.click(screen.getByRole('menuitem', { name: kind }))
  await frames()
}

describe('a "+" on every continue arrow, and nowhere else', () => {
  it('one per continue arrow, named for where it adds, in conversation order; answer arrows get none', async () => {
    render(<Harness initial={branching()} />)
    await frames()
    const continueArrows = buildFlow(latest).edges.filter((e) => !e.option)
    expect(plusButtons()).toHaveLength(continueArrows.length)
    expect(new Set(continueArrows.map((e) => e.source)).size).toBe(continueArrows.length)
    expect(plusButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'הוספת שאלה אחרי הודעת הפתיחה',
      'הוספת שאלה אחרי שאלה 1',
      'הוספת שאלה אחרי שאלה 2',
      'הוספת שאלה אחרי שאלה 3',
      'הוספת שאלה אחרי שאלה 4',
    ])
  })

  it('an empty questionnaire offers its first-question button instead, not a "+"', async () => {
    render(<Harness initial={empty()} />)
    await frames()
    expect(plusButtons()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'הוספת השאלה הראשונה' }))
    await frames()
    await choose(/תשובה חופשית/)
    expect(latest.questions).toHaveLength(1)
    // Now there is a question: its arrows have their "+".
    expect(plusButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['הוספת שאלה אחרי הודעת הפתיחה', 'הוספת שאלה אחרי שאלה 1'])
  })
})

describe('adding a question from an arrow', () => {
  it('between two questions: exactly one question, in that place, its editor open with the cursor in it', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    fireEvent.click(plus('שאלה 1'))
    await frames()
    expect(screen.getByRole('menu')).toBeTruthy()
    await choose(/בחירה של תשובה אחת/)
    expect(latest.questions).toHaveLength(4)
    expect(latest.questions.map((q) => keyOf(q)).filter((k) => !k.startsWith('new_'))).toEqual(['q_a', 'q_b', 'q_c'])
    expect(keyOf(latest.questions[1])).toMatch(/^new_/)
    expect(latest.questions[1].answer.kind).toBe('single_choice')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('מה נשאל את הלקוח'))
    expect(document.activeElement?.closest('.react-flow__node')?.textContent).toContain('שאלה 2')
  })

  it('on the last arrow: immediately before the ending', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    fireEvent.click(plus('שאלה 3'))
    await frames()
    await choose(/תשובה חופשית/)
    expect(latest.questions).toHaveLength(4)
    expect(keyOf(latest.questions[3])).toMatch(/^new_/)
  })

  it("on a branch's arrow: it joins that branch (its condition), other branches are untouched", async () => {
    render(<Harness initial={branching()} />)
    await frames()
    const before = latest.questions.map((q) => ({ key: keyOf(q), when: conditionOf(q) }))
    fireEvent.click(plus('שאלה 1')) // question 1's continue arrow goes to q_field (the main path)
    await frames()
    await choose(/תשובה חופשית/)
    const keys = latest.questions.map(keyOf)
    const added = latest.questions[keys.indexOf('q_field') - 1]
    expect(keyOf(added)).toMatch(/^new_/)
    expect(conditionOf(added)).toEqual({ questionId: 'q_kind', anyOf: ['o_learn', 'o_price'] })
    expect(latest.questions.filter((q) => q !== added).map((q) => ({ key: keyOf(q), when: conditionOf(q) }))).toEqual(before)
  })

  it('the list shows the same question in the same place', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    fireEvent.click(plus('שאלה 2'))
    await frames()
    await choose(/תשובה חופשית/)
    fireEvent.change(screen.getByLabelText('מה נשאל את הלקוח'), { target: { value: 'שאלה שנוספה מהחץ' } })
    fireEvent.click(screen.getByRole('button', { name: 'החלפת תצוגה' }))
    await frames()
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(4)
    expect((cards[2].querySelector('textarea') as HTMLTextAreaElement).value).toBe('שאלה שנוספה מהחץ')
  })
})

describe('the "+" is a real, keyboard-usable control that never changes anything by itself', () => {
  it('is a button that opens a menu; its first choice takes focus; clicking it does not open the box it belongs to', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    const b = plus('שאלה 1')
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('aria-haspopup')).toBe('menu')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    b.focus()
    fireEvent.click(b)
    await frames()
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    expect(document.querySelector('.react-flow__node.selected')).toBeNull()
    expect(b.isConnected).toBe(true)
  })

  it('Escape closes the menu, adds nothing, and returns to the same "+"', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    const before = JSON.stringify(latest)
    const b = plus('שאלה 2')
    fireEvent.click(b)
    await frames()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    await frames()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(JSON.stringify(latest)).toBe(before)
    expect(document.activeElement).toBe(b)
  })

  it('a click elsewhere closes the menu and adds nothing', async () => {
    render(<Harness initial={linear()} />)
    await frames()
    const before = JSON.stringify(latest)
    fireEvent.click(plus('שאלה 2'))
    await frames()
    // jsdom's synthetic mousedown has no view, which the map's pan handler needs; stop it at the
    // pane (as the pan handler itself does in a browser). The menu listens in the capture phase.
    const pane = document.querySelector('.react-flow__pane') as HTMLElement
    pane.addEventListener('mousedown', (e) => e.stopPropagation())
    fireEvent.mouseDown(pane)
    await frames()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(JSON.stringify(latest)).toBe(before)
  })
})
