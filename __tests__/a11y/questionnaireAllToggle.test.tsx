// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FlowAllToggle from '@/components/settings/questionnaire/flow/FlowAllToggle'

/**
 * "אפשר לענות 'הכל'" (natural answers): a labelled control, reachable by its
 * name, that reports its state.
 */
vi.mock('@/components/settings/questionnaire/flow/flowContext', () => ({ useFlowEditor: () => ({ edit: vi.fn() }) }))

describe('accepts-all toggle', () => {
  it('has an accessible name that says what it does', () => {
    render(<FlowAllToggle questionKey='needs' allowAll={false} />)
    expect(screen.getByRole('checkbox', { name: 'אפשר לענות "הכל"' })).toBeInTheDocument()
  })
  it('reports when it is on', () => {
    render(<FlowAllToggle questionKey='needs' allowAll />)
    expect(screen.getByRole('checkbox', { name: 'אפשר לענות "הכל"' })).toBeChecked()
  })
})
