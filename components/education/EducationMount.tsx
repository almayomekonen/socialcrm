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
      {toursEnabled && surface === 'desktop' ? (
        <Suspense fallback={null}>
          <ProductTourHost />
        </Suspense>
      ) : null}
    </EducationProvider>
  )
}
