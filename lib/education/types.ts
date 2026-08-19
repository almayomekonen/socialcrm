export const EDU_ATTR = 'data-edu'

export function eduSel(id: string): string {
  return `[${EDU_ATTR}="${id}"]`
}

export type TourId = 'overview' | 'pipeline' | 'lead' | 'copilot' | 'whatsapp' | 'facebook'

export type TourStatus = 'completed' | 'dismissed'

export type TourStartSource = 'auto' | 'help' | 'query' | 'copilot'

export type TourRecord = {
  version: number
  status: TourStatus
  at: string
  lastStep?: number
}

export type EducationState = {
  tours: Partial<Record<TourId, TourRecord>>
}

export type Surface = 'desktop' | 'mobile'

export type EligibilityContext = {
  surface: Surface
  toursEnabled: boolean
  copilotEnabled: boolean
  firstLeadActive: boolean
  pathname: string
  force?: boolean
  record?: TourRecord
}

export type TourStep = {
  element?: string
  title: string
  description: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

export type TourDefinition = {
  id: TourId
  version: number
  /** When false, the tour never auto-starts — only Help / ?tour= / Copilot Show me / force. */
  auto: boolean
  requiresCopilot?: boolean
  blockedByFirstLead?: boolean
  steps: TourStep[]
}
