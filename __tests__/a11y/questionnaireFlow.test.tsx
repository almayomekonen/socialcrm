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

vi.mock('@/actions/questionnaire/builderPublish', () => ({ simulateQuestionnaireDraft: vi.fn(), listQuestionnaireRevisions: vi.fn() }))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))

import FlowWorkspace from '@/components/settings/questionnaire/flow/FlowWorkspace'
import ConversationWorkspace from '@/components/settings/questionnaire/ConversationWorkspace'
import { applyTextCheck } from '@/components/settings/questionnaire/answerCheck'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
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

const pp = toBuilder(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8')))

/** A stand-in for the Builder: one draft, edited by whichever view is shown. */
let latest: BuilderQuestionnaire
function Harness({ initial, view: start = 'flow' }: { initial: BuilderQuestionnaire; view?: 'flow' | 'conversation' }) {
  const [model, setModel] = useState(initial)
  const [mode, setMode] = useState(start)
  latest = model
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
    expect(screen.getByText('הודעת פתיחה')).toBeTruthy()
    expect(screen.getByText('סיום השיחה')).toBeTruthy()
    // Boxes read like WhatsApp: numbered answers with their icons.
    expect(within(box(1)).getByText(/1\. חתונה/).textContent).toContain('💍')
    // Conditional endings are sentences, not more boxes.
    expect(screen.getByText('הלקוח בחר חתונה בשאלה "סוג האירוע / השירות"')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה' }))
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
