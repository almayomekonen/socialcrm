'use client'

import { useEffect } from 'react'
import type { TourId } from '@/lib/education'
import { useEducation } from './EducationProvider'

export default function AutoTour({ id, enabled }: { id: TourId; enabled: boolean }) {
  const { maybeStart, toursEnabled } = useEducation()

  useEffect(() => {
    if (!enabled || !toursEnabled) return
    maybeStart(id)
  }, [id, enabled, toursEnabled, maybeStart])

  return null
}
