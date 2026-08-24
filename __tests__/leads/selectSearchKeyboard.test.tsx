// @vitest-environment jsdom

/**
 * `SelectSearch` keyboard operation.
 *
 * The autocomplete could previously only be finished with a mouse: its options
 * answered `onMouseDown` and the input answered no key at all. This is the
 * enhancement layer — it is NOT the fix for the search-scope defect, which is
 * covered by `leadSearchScope.test.ts` and `clientsTable.test.tsx`.
 *
 * The last two cases are the guardrails: `SelectSearch` is embedded in real
 * forms elsewhere (SaleForm, AddTaskForm, the tasks filter bar), where Enter
 * submits the form and must keep doing so.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SelectSearch } from '@/lib/form/SelectSearch'

afterEach(cleanup)

const RESULTS = [
  { id: 1, details: 'ספי ברהנה' },
  { id: 2, details: 'ספי כהן' },
  { id: 3, details: 'ספי לוי' },
]

function setup(overrides: Record<string, unknown> = {}) {
  const onSelectOpt = vi.fn()
  const searchFunc = vi.fn(async () => RESULTS)
  render(
    <SelectSearch
      options={[]}
      show='details'
      val='id'
      selected={null}
      initShow={null}
      searchFunc={searchFunc as never}
      onSelectOpt={onSelectOpt}
      {...overrides}
    />,
  )
  const input = screen.getAllByRole('combobox')[0]
  return { input, onSelectOpt, searchFunc }
}

/**
 * Type a term and wait for the dropdown to be fully settled.
 *
 * Waiting for the listbox alone is not enough: a new result set resets the
 * highlight in an effect, and under load that effect can flush AFTER the
 * listbox is queryable — landing on top of an arrow press and making the next
 * assertion fail intermittently. Waiting until no option is active means the
 * reset has already happened.
 */
async function openWithResults() {
  const ctx = setup()
  fireEvent.focus(ctx.input)
  fireEvent.change(ctx.input, { target: { value: 'ספי' } })
  await screen.findByRole('listbox')
  await waitFor(() => expect(activeOption()).toBeUndefined())
  return ctx
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent)
const activeOption = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')

describe('SelectSearch keyboard navigation', () => {
  it('typing still opens the list — unchanged behaviour', async () => {
    const { searchFunc } = await openWithResults()
    expect(searchFunc).toHaveBeenCalledWith('ספי')
    expect(optionNames()).toEqual(['ספי ברהנה', 'ספי כהן', 'ספי לוי'])
  })

  it('Enter selects the highlighted result', async () => {
    const { input, onSelectOpt } = await openWithResults()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelectOpt).toHaveBeenCalledTimes(1)
    expect(onSelectOpt).toHaveBeenCalledWith(RESULTS[1])
  })

  it('Enter with nothing highlighted takes the top match for a PICKER consumer', async () => {
    // No `onSubmitText` — the SaleForm / AddTaskForm behaviour, unchanged.
    const { input, onSelectOpt } = await openWithResults()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelectOpt).toHaveBeenCalledWith(RESULTS[0])
  })

  it('Enter with nothing highlighted commits the TYPED TEXT for a search consumer', async () => {
    const onSubmitText = vi.fn()
    const onSelectOpt = vi.fn()
    const searchFunc = vi.fn(async () => RESULTS)
    render(
      <SelectSearch
        options={[]}
        show='details'
        val='id'
        selected={null}
        initShow={null}
        searchFunc={searchFunc as never}
        onSelectOpt={onSelectOpt}
        onSubmitText={onSubmitText}
      />,
    )
    const input = screen.getAllByRole('combobox')[0]
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ספי' } })
    await screen.findByRole('listbox')

    fireEvent.keyDown(input, { key: 'Enter' })

    // The whole point: a partial term reaches the server as itself, instead of
    // silently resolving to one lead's full name.
    expect(onSubmitText).toHaveBeenCalledWith('ספי')
    expect(onSelectOpt).not.toHaveBeenCalled()
  })

  it('an explicit highlight still wins over the typed text', async () => {
    const onSubmitText = vi.fn()
    const onSelectOpt = vi.fn()
    const searchFunc = vi.fn(async () => RESULTS)
    render(
      <SelectSearch
        options={[]}
        show='details'
        val='id'
        selected={null}
        initShow={null}
        searchFunc={searchFunc as never}
        onSelectOpt={onSelectOpt}
        onSubmitText={onSubmitText}
      />,
    )
    const input = screen.getAllByRole('combobox')[0]
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ספי' } })
    await screen.findByRole('listbox')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelectOpt).toHaveBeenCalledWith(RESULTS[0])
    expect(onSubmitText).not.toHaveBeenCalled()
  })

  it('ArrowDown moves the highlight down and stops at the last option', async () => {
    const { input } = await openWithResults()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('ספי ברהנה')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('ספי כהן')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('ספי לוי')
  })

  it('ArrowUp moves the highlight up and stops at the first option', async () => {
    const { input } = await openWithResults()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('ספי כהן')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(activeOption()).toHaveTextContent('ספי ברהנה')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(activeOption()).toHaveTextContent('ספי ברהנה')
  })

  it('Escape closes the dropdown without selecting', async () => {
    const { input, onSelectOpt } = await openWithResults()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSelectOpt).not.toHaveBeenCalled()
  })

  it('keyboard-only flow: type → arrow → Enter selects and closes the list', async () => {
    const { input, onSelectOpt } = await openWithResults()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelectOpt).toHaveBeenCalledWith(RESULTS[0])
    expect((input as HTMLInputElement).value).toBe('ספי ברהנה')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('mouse selection still works', async () => {
    const { onSelectOpt } = await openWithResults()

    fireEvent.mouseDown(screen.getByText('ספי כהן'))

    expect(onSelectOpt).toHaveBeenCalledWith(RESULTS[1])
  })

  it('exposes combobox/listbox semantics with an active descendant', async () => {
    const { input } = await openWithResults()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(input.getAttribute('aria-activedescendant')).toBe(activeOption()!.id)
  })

  // ── Guardrails: no form is introduced, and host forms keep working ─────────

  it('renders no form of its own', () => {
    const { input } = setup()
    expect((input as HTMLInputElement).form).toBeNull()
    expect(input.closest('form')).toBeNull()
  })

  it('Enter with no open list is passed through, so a host form still submits', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const onSelectOpt = vi.fn()
    render(
      <form onSubmit={onSubmit}>
        <SelectSearch options={[]} show='details' val='id' selected={null} initShow={null} onSelectOpt={onSelectOpt} />
      </form>,
    )
    const input = screen.getAllByRole('combobox')[0]

    const evt = fireEvent.keyDown(input, { key: 'Enter' })

    // Not consumed → the browser's implicit submission is left intact.
    expect(evt).toBe(true)
    expect(onSelectOpt).not.toHaveBeenCalled()
  })
})
