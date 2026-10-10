// @vitest-environment jsdom
//
// Two failures seen on agency 103's Flow canvas (2026-10-10):
//   1. With every question deleted, the map showed only an empty opening and
//      ending, and nothing said how to start again.
//   2. "+ הוספת שאלה לפני הסיום" opened its menu past the canvas's right edge
//      (inline END in RTL = left:0, so it grew rightwards out of the clipped
//      canvas); the start of each choice was cut off, and a click there landed
//      outside the menu and only dismissed it.
// Geometry is verified in a real browser; here the behaviour around it is.

import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/actions/questionnaire/builderPublish', () => ({ simulateQuestionnaireDraft: vi.fn(), listQuestionnaireRevisions: vi.fn() }))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))

import FlowWorkspace from '@/components/settings/questionnaire/flow/FlowWorkspace'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
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

/** Agency 103's draft as the owner left it: no questions, no opening, no ending. */
const empty = () =>
  toBuilder({
    schemaVersion: 1,
    revision: 3,
    language: 'he',
    welcome: '',
    closing: '',
    handoff: 'תודה, העברנו את הפרטים שלכם לנציג שיחזור אליכם.',
    summaryTitle: 'שאלון וואטסאפ',
    expireAfterHours: 24,
    maxInvalidAttempts: 2,
    steps: [],
  } as never)
const oneQuestion = () => toBuilder(emptyQuestionnaire('סלון'))

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
const menu = () => screen.queryByRole('menu')

describe('an empty questionnaire says how to start', () => {
  it('shows Hebrew guidance and exactly one call to action, instead of "+ הוספת שאלה לפני הסיום"', async () => {
    render(<Harness initial={empty()} />)
    await frames()
    const state = screen.getByRole('region', { name: 'עוד אין שאלות בשאלון' })
    expect(state.textContent).toContain('הוסיפו את השאלה הראשונה')
    expect(screen.getAllByRole('button', { name: /^הוספת השאלה הראשונה$/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'הוספת שאלה לפני הסיום' })).toBeNull()
    // The opening and ending stay on the map.
    expect(screen.getByRole('button', { name: 'עריכת הודעת הפתיחה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'עריכת הודעות הסיום' })).toBeTruthy()
  })

  it('the call to action opens the usual menu; choosing a type adds exactly one question, ready to edit', async () => {
    render(<Harness initial={empty()} />)
    await frames()
    fireEvent.click(screen.getByRole('button', { name: 'הוספת השאלה הראשונה' }))
    await frames()
    expect(menu()).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /תשובה חופשית/ }))
    await frames()
    expect(latest.questions).toHaveLength(1)
    expect(latest.questions[0].answer.kind).toBe('text')
    expect(menu()).toBeNull()
    // Now a questionnaire with a question: the guidance gives way to the usual control, and the new box is open.
    expect(screen.queryByRole('region', { name: 'עוד אין שאלות בשאלון' })).toBeNull()
    expect(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' })).toBeTruthy()
    expect(screen.getByLabelText('מה נשאל את הלקוח')).toBeTruthy()
  })
})

describe('"+ הוספת שאלה לפני הסיום" opens inside the canvas and only adds on a choice', () => {
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' }))
    await frames()
  }

  it('the menu hangs from the button\'s right edge in RTL (inline start), growing into the canvas, not past its edge', async () => {
    render(<Harness initial={oneQuestion()} />)
    await frames()
    await open()
    const m = menu() as HTMLElement
    expect(m.closest('[dir]')?.getAttribute('dir')).toBe('rtl')
    expect(m.className).toContain('start-0')
    expect(m.className).not.toMatch(/(^|\s)end-0(\s|$)/)
  })

  it('choosing a type adds the question and closes the menu', async () => {
    render(<Harness initial={oneQuestion()} />)
    await frames()
    const before = latest.questions.length
    await open()
    fireEvent.click(screen.getByRole('menuitem', { name: /בחירה של תשובה אחת/ }))
    await frames()
    expect(latest.questions).toHaveLength(before + 1)
    expect(latest.questions[before].answer.kind).toBe('single_choice')
    expect(menu()).toBeNull()
  })

  it('Escape closes it without adding anything, and returns to the button', async () => {
    render(<Harness initial={oneQuestion()} />)
    await frames()
    const before = JSON.stringify(latest)
    await open()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    await frames()
    expect(menu()).toBeNull()
    expect(JSON.stringify(latest)).toBe(before)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'הוספת שאלה לפני הסיום' }))
  })

  it('a click on the map closes it without adding anything (the map stops mousedown from bubbling)', async () => {
    render(<Harness initial={oneQuestion()} />)
    await frames()
    const before = JSON.stringify(latest)
    await open()
    const pane = document.querySelector('.react-flow__pane') as HTMLElement
    pane.addEventListener('mousedown', (e) => e.stopPropagation())
    fireEvent.mouseDown(pane)
    await frames()
    expect(menu()).toBeNull()
    expect(JSON.stringify(latest)).toBe(before)
  })

  it('a questionnaire with questions is unchanged: no empty-state guidance, the usual button only', async () => {
    render(<Harness initial={oneQuestion()} />)
    await frames()
    expect(screen.queryByRole('region', { name: 'עוד אין שאלות בשאלון' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'הוספת השאלה הראשונה' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'הוספת שאלה לפני הסיום' })).toHaveLength(1)
  })
})
