// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import InboxRouteSkeleton from '@/modules/inbox/components/InboxRouteSkeleton'
import LeadsSkeletonMobile from '@/components/mobile/skeletons/LeadsSkeletonMobile'
import TodaySkeletonMobile from '@/components/mobile/skeletons/TodaySkeletonMobile'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'
import InboxThreadSkeletonMobile from '@/components/mobile/skeletons/InboxThreadSkeletonMobile'
import NotificationsSkeletonMobile from '@/components/mobile/skeletons/NotificationsSkeletonMobile'
import MoreSkeletonMobile from '@/components/mobile/skeletons/MoreSkeletonMobile'
import LeadDetailSkeletonMobile from '@/components/mobile/skeletons/LeadDetailSkeletonMobile'
import IntegrationsSkeletonMobile from '@/components/mobile/skeletons/IntegrationsSkeletonMobile'
import ReadyMessagesSkeletonMobile from '@/components/mobile/skeletons/ReadyMessagesSkeletonMobile'
import MobileChromeSkeleton from '@/components/mobile/skeletons/MobileChromeSkeleton'
import MobileInnerSkeleton from '@/components/mobile/skeletons/MobileInnerSkeleton'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import { MobileWorkspaceContext } from '@/components/mobile/MobileWorkspaceContext'

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

describe('mobile skeletons — geometry matches the phone entity', () => {
  it('leads mobile skeleton is cards, never a table', () => {
    const { container } = render(<LeadsSkeletonMobile />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('leads-skeleton-mobile')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
    expect(container.querySelectorAll('.size-11').length).toBeGreaterThan(0)
    expect(container.querySelector('.h-11.w-full')).toBeTruthy()
  })

  it('today mobile skeleton is a hero card plus compact rows, never columns', () => {
    const { container } = render(<TodaySkeletonMobile />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('today-skeleton-mobile')).toBeTruthy()
    expect(container.querySelector('.rounded-xl.border')).toBeTruthy()
  })

  it('inbox list skeleton is rows with a channel mark, never the 3-pane desktop shell', () => {
    const { container } = render(<InboxListSkeletonMobile />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('inbox-skeleton-mobile')).toBeTruthy()
    expect(container.querySelectorAll('.size-10').length).toBeGreaterThan(0)
  })

  it('inbox thread skeleton is identity + bubbles + composer', () => {
    const { container } = render(<InboxThreadSkeletonMobile />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('inbox-thread-skeleton-mobile')).toBeTruthy()
    expect(container.querySelector('.h-11.w-full')).toBeTruthy()
  })

  it('notifications / more / lead detail / integrations / ready messages never render a table', () => {
    for (const node of [
      <NotificationsSkeletonMobile key='n' />,
      <MoreSkeletonMobile key='m' />,
      <LeadDetailSkeletonMobile key='d' />,
      <IntegrationsSkeletonMobile key='i' />,
      <ReadyMessagesSkeletonMobile key='r' />,
    ]) {
      const { container, unmount } = render(node)
      expect(container.querySelector('table')).toBeNull()
      unmount()
    }
  })

  it('chrome skeleton is the phone shell, not the size-32 desktop spinner', () => {
    const { container } = render(<MobileChromeSkeleton path='/leads' />)
    expect(screen.getByTestId('mobile-chrome-skeleton')).toBeTruthy()
    expect(screen.getByTestId('leads-skeleton-mobile')).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('.size-32')).toBeNull()
  })

  it('inner skeleton follows the destination path', () => {
    const { rerender } = render(<MobileInnerSkeleton path='/inbox?conversation=12' />)
    expect(screen.getByTestId('inbox-thread-skeleton-mobile')).toBeTruthy()
    rerender(<MobileInnerSkeleton path='/notifications' />)
    expect(screen.getByTestId('notifications-skeleton-mobile')).toBeTruthy()
    rerender(<MobileInnerSkeleton path='/settings/integrations?section=templates' />)
    expect(screen.getByTestId('ready-messages-skeleton-mobile')).toBeTruthy()
  })
})

describe('loading.tsx files actually branch on the phone entity', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
  const loadingFiles = [
    'app/(app)/loading.tsx',
    'app/(app)/leads/loading.tsx',
    'app/(app)/inbox/loading.tsx',
    'app/(app)/inbox/comments/loading.tsx',
    'app/(app)/clients/loading.tsx',
    'app/(app)/clients/[clientId]/loading.tsx',
    'app/(app)/dashboard/loading.tsx',
    'app/(app)/notifications/loading.tsx',
    'app/(app)/m/loading.tsx',
    'app/(app)/settings/loading.tsx',
    'app/(app)/settings/(user_settings)/integrations/loading.tsx',
  ]

  it('leads loading serves LeadsSkeletonMobile on phone and keeps the table for desktop', () => {
    const src = read('app/(app)/leads/loading.tsx')
    expect(src).toContain('EntityLoading')
    expect(src).toContain('LeadsSkeletonMobile')
    expect(src).toContain('LeadsTableSkeleton')
  })

  it('inbox loading serves the mobile list/thread, not only InboxRouteSkeleton', () => {
    const src = read('app/(app)/inbox/loading.tsx')
    expect(src).toContain('InboxSegmentLoading')
    const inbox = read('components/mobile/skeletons/InboxSegmentLoading.tsx')
    expect(inbox).toContain('InboxListSkeletonMobile')
    expect(inbox).toContain('InboxThreadSkeletonMobile')
    expect(inbox).toContain('InboxRouteSkeleton')
  })

  it('loading.tsx never awaits headers — that is the stuck-skeleton failure', () => {
    for (const rel of loadingFiles) {
      const src = read(rel)
      expect(src, rel).not.toMatch(/\basync function\b/)
      expect(src, rel).not.toContain('isPhoneEntity')
      expect(src, rel).not.toContain('requestPathHint')
      expect(src, rel).not.toContain("from 'next/headers'")
    }
  })

  it('app layout Suspense fallback is phone chrome, not the desktop spinner alone', () => {
    const src = read('app/(app)/layout.tsx')
    expect(src).toContain('MobileChromeSkeleton')
    expect(src).toContain('PhoneAwareShell')
    expect(src).toContain('getDeviceClass')
    expect(src).toMatch(/phone \? <MobileChromeSkeleton/)
    expect(src).not.toContain('requestPathHint')
  })
})

describe('EntityLoading commits only the matching entity', () => {
  it('phone context renders the phone skeleton and not the desktop table', () => {
    const { container } = render(
      <MobileWorkspaceContext.Provider value={true}>
        <EntityLoading phone={<LeadsSkeletonMobile />} desktop={<LeadsTableSkeleton />} />
      </MobileWorkspaceContext.Provider>,
    )
    expect(screen.getByTestId('leads-skeleton-mobile')).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
    expect(screen.queryByTestId('leads-route-skeleton')).toBeNull()
  })

  it('desktop default renders the table skeleton and not the phone cards', () => {
    const { container } = render(
      <EntityLoading phone={<LeadsSkeletonMobile />} desktop={<LeadsTableSkeleton />} />,
    )
    expect(screen.getByTestId('leads-route-skeleton')).toBeTruthy()
    expect(screen.queryByTestId('leads-skeleton-mobile')).toBeNull()
    expect(container.querySelector('table')).toBeTruthy()
  })
})
