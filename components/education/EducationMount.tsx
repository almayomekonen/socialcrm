'use client'

import { Suspense, type ReactNode } from 'react'
import { EducationProvider } from './EducationProvider'
import ProductTourHost from './ProductTourHost'
import type { Surface } from '@/lib/education'

export default function EducationMount({
  userId,
  surface,
  copilotEnabled,
  toursEnabled,
  children,
}: {
  userId: number
  surface: Surface
  copilotEnabled: boolean
  toursEnabled: boolean
  children: ReactNode
}) {
  return (
    <EducationProvider userId={userId} surface={surface} copilotEnabled={copilotEnabled} toursEnabled={toursEnabled}>
      {children}
      {/*
        THE MENU MUST MOUNT WHEREVER THE BUTTON CAN BE PRESSED.
        `HelpMenu` is rendered by ProductTourHost, so gating this on
        `toursEnabled` would leave a lapsed customer with a Help button that
        opens nothing. Mounting it on `surface` alone keeps the button honest.

        This does NOT re-enable tours. Every auto-run path inside
        ProductTourHost — query-param launch, the overview-intro offer and the
        copilot auto-start — returns early on `!toursEnabled` individually, and
        so do the provider's own auto-start effects. With tours disabled the
        host renders exactly two nulls until the customer opens Help themselves.
      */}
      {surface === 'desktop' ? (
        <Suspense fallback={null}>
          <ProductTourHost />
        </Suspense>
      ) : null}
    </EducationProvider>
  )
}
