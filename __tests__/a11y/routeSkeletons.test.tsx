// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import InboxRouteSkeleton from '@/modules/inbox/components/InboxRouteSkeleton'

afterEach(cleanup)

describe('route skeletons (Wave A4)', () => {
  it('leads skeleton exposes aria-busy and Hebrew loading status', () => {
    render(<LeadsTableSkeleton />)
    const root = screen.getByTestId('leads-route-skeleton')
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
    expect(screen.getByRole('status').className).toContain('sr-only')
  })

  it('leads skeleton does not render dash placeholder cells as content', () => {
    const { container } = render(<LeadsTableSkeleton />)
    expect(container.textContent).not.toMatch(/- - - -/)
  })

  it('inbox skeleton exposes aria-busy and Hebrew loading status', () => {
    render(<InboxRouteSkeleton />)
    const root = screen.getByTestId('inbox-route-skeleton')
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
  })

  it('clients variant omits status tab strip', () => {
    const { rerender, container } = render(<LeadsTableSkeleton withStatusTabs />)
    expect(container.querySelector('.mb-3.flex.gap-1.border-b')).toBeTruthy()
    rerender(<LeadsTableSkeleton withStatusTabs={false} />)
    expect(container.querySelector('.mb-3.flex.gap-1.border-b')).toBeNull()
  })
})
