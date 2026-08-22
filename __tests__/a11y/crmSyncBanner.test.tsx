// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CrmSyncHealthProvider, useCrmSyncHealth } from '@/lib/polling/CrmSyncHealthContext'
import CrmSyncBanner from '@/components/clients/CrmSyncBanner'
import { useEffect } from 'react'

afterEach(cleanup)

function Seed({ failures, retry }: { failures: number; retry?: () => void }) {
  const { report } = useCrmSyncHealth()
  useEffect(() => {
    report('leads', failures, retry ?? null)
  }, [failures, retry, report])
  return null
}

describe('CrmSyncBanner (Wave A6)', () => {
  it('stays hidden below threshold', () => {
    render(
      <CrmSyncHealthProvider>
        <Seed failures={2} />
        <CrmSyncBanner sources={['leads']} />
      </CrmSyncHealthProvider>,
    )
    expect(screen.queryByText('בעיית חיבור. מנסים שוב')).toBeNull()
  })

  it('shows after 3 failures and Retry fires', () => {
    const retry = vi.fn()
    render(
      <CrmSyncHealthProvider>
        <Seed failures={3} retry={retry} />
        <div data-alert-region='crm-sync'>
          <CrmSyncBanner sources={['leads']} />
        </div>
      </CrmSyncHealthProvider>,
    )
    expect(screen.getByText('בעיית חיבור. מנסים שוב')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('clears when failures reset to 0', () => {
    const { rerender } = render(
      <CrmSyncHealthProvider>
        <Seed failures={3} />
        <CrmSyncBanner sources={['leads']} />
      </CrmSyncHealthProvider>,
    )
    expect(screen.getByText('בעיית חיבור. מנסים שוב')).toBeInTheDocument()
    rerender(
      <CrmSyncHealthProvider>
        <Seed failures={0} />
        <CrmSyncBanner sources={['leads']} />
      </CrmSyncHealthProvider>,
    )
    expect(screen.queryByText('בעיית חיבור. מנסים שוב')).toBeNull()
  })
})
