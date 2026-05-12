'use client'

import type { ReactNode } from 'react'
import { useCopilot } from '@/lib/copilot/useCopilot'

export default function WorkspaceGrid({ children }: { children: ReactNode }) {
  const { open, enabled } = useCopilot()
  const isOpen = enabled && open
  return (
    <>
      <div className={`desktop:grid workspace-grid flex-1 min-h-0${isOpen ? ' copilot-open' : ''}`}>
        {children}
      </div>
      <div aria-hidden='true' className='workspace-rail hidden desktop:block' />
    </>
  )
}
