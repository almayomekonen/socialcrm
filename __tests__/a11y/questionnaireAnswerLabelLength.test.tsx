// @vitest-environment jsdom
//
// Reported 2026-10-10: the owner typed "באמצעות Excel או Google Sheets" and the
// answer was saved as "באמצעות Excel או Google". Both answer inputs had
// maxLength={24}, which the browser enforces in silence: "Sheets" was never
// accepted, and the trailing space was trimmed on save.
//
// Now an answer may be up to 40 characters, in the List view and the Flow view
// alike. Its length is always shown; input past 40 is refused as a whole and
// said so; a label past WhatsApp's list row limit (24) on a single-choice
// question says the question goes out as the numbered menu.

import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/actions/questionnaire/builderPublish', () => ({ simulateQuestionnaireDraft: vi.fn(), listQuestionnaireRevisions: vi.fn() }))
vi.mock('@/actions/questionnaire/builderDraft', () => ({}))

import FlowWorkspace from '@/components/settings/questionnaire/flow/FlowWorkspace'
import ConversationWorkspace from '@/components/settings/questionnaire/ConversationWorkspace'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { deriveEditorView, previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { optionsOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { planInteractive } from '@/lib/inbox/autoresponse/questionnaire/interactive'
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

const LONG = 'באמצעות Excel או Google Sheets'
const FORTY = 'א'.repeat(40)
const MENU_NOTICE = /בוואטסאפ השאלה תישלח כרשימה ממוספרת/

const base = { schemaVersion: 1, revision: 1, language: 'he', welcome: 'היי', closing: 'תודה', handoff: 'נציג', summaryTitle: 'סיכום', expireAfterHours: 24, maxInvalidAttempts: 2 }
const questionnaire = (multi = false) =>
  toBuilder({
    ...base,
    steps: [
      { id: 'q_how', type: 'choice', label: 'איך', prompt: 'איך אתם מנהלים לידים היום?', ...(multi ? { multi: true } : {}), options: [
        { id: 'o_sheet', label: 'גיליון' }, { id: 'o_none', label: 'בלי מערכת' },
      ] },
    ],
  } as never)

let latest: BuilderQuestionnaire
function Harness({ initial, view }: { initial: BuilderQuestionnaire; view: 'flow' | 'list' }) {
  const [model, setModel] = useState(initial)
  latest = model
  const common = { model, view: deriveEditorView(model), edit: (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => setModel((m) => change(m)), confirm: (r: { run: () => void }) => r.run(), announce: () => {}, draftId: 1, flush: async () => true, onNotReady: () => {} }
  return view === 'flow' ? (
    <FlowWorkspace {...common} issuesFor={() => []} leave={() => {}} panel='none' setPanel={() => {}} openConversation={() => {}} />
  ) : (
    <ConversationWorkspace {...common} canEdit revealAll={false} touched={new Set()} touch={() => {}} testing={false} stopTesting={() => {}} />
  )
}
const frames = () => act(async () => new Promise((r) => setTimeout(r, 120)))
const label1 = () => optionsOf(latest.questions[0])[0].label

/** Renders a view with its first answer's input ready to type in. */
async function setup(view: 'flow' | 'list', multi = false): Promise<HTMLInputElement> {
  render(<Harness initial={questionnaire(multi)} view={view} />)
  await frames()
  if (view === 'flow') {
    fireEvent.click(screen.getByRole('button', { name: /עריכת שאלה 1/ }))
    await frames()
    return screen.getByLabelText('תשובה 1') as HTMLInputElement
  }
  return screen.getByLabelText('שם האפשרות 1') as HTMLInputElement
}
const type = async (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } })
  await frames()
}
const describedText = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')

for (const view of ['list', 'flow'] as const) {
  describe(`${view} view`, () => {
    it('takes "באמצעות Excel או Google Sheets" whole: no maxLength, the draft and the preview hold all 30 characters', async () => {
      const input = await setup(view)
      expect(input.hasAttribute('maxlength')).toBe(false)
      await type(input, LONG)
      expect(input.value).toBe(LONG)
      expect(label1()).toBe(LONG)
      const step = previewDefinition(latest)!.steps[0] as { options: Array<{ label: string }> }
      expect(step.options[0].label).toBe(LONG)
    })

    it('shows the length, and tells a screen reader too', async () => {
      const input = await setup(view)
      await type(input, LONG)
      expect(describedText(input)).toContain('30/40')
      await type(input, FORTY)
      expect(label1()).toBe(FORTY)
      expect(describedText(input)).toContain('40/40')
    })

    it('past 40, the input is refused whole and the owner is told; what was typed stays', async () => {
      const input = await setup(view)
      await type(input, FORTY)
      await type(input, `${FORTY}ב`)
      expect(label1()).toBe(FORTY)
      expect(input.value).toBe(FORTY)
      expect(describedText(input)).toMatch(/אפשר עד 40 תווים בתשובה/)
      // A paste past the limit is not cut to fit either.
      await type(input, LONG)
      await type(input, `${LONG} ובעוד כמה מקומות`)
      expect(label1()).toBe(LONG)
      // Back within the limit, the message goes away.
      await type(input, 'גיליון')
      expect(describedText(input)).not.toMatch(/אפשר עד 40/)
    })

    it('over 24 on a single-choice question: says WhatsApp sends it as the numbered menu (which is what the runtime does)', async () => {
      const input = await setup(view)
      await type(input, 'א'.repeat(24))
      expect(screen.queryByText(MENU_NOTICE)).toBeNull()
      expect(planInteractive(previewDefinition(latest)!.steps[0])).not.toBeNull() // still tap-to-select
      await type(input, LONG)
      expect(screen.getByText(MENU_NOTICE)).toBeTruthy()
      expect(describedText(input)).toMatch(MENU_NOTICE)
      expect(planInteractive(previewDefinition(latest)!.steps[0])).toBeNull()
    })

    it('short answers are unchanged: no notice, no refusal', async () => {
      const input = await setup(view)
      await type(input, 'גיליון אקסל')
      expect(label1()).toBe('גיליון אקסל')
      expect(screen.queryByText(MENU_NOTICE)).toBeNull()
      expect(describedText(input)).not.toMatch(/אפשר עד 40/)
    })

    it('a multi-choice question is always the numbered menu, so it has no notice', async () => {
      const input = await setup(view, true)
      await type(input, LONG)
      expect(label1()).toBe(LONG)
      expect(screen.queryByText(MENU_NOTICE)).toBeNull()
    })
  })
}
