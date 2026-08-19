import { eduSel, type TourDefinition, type TourId } from './types'

const TOURS: TourDefinition[] = [
  {
    id: 'overview',
    version: 1,
    auto: false,
    steps: [
      {
        element: eduSel('nav-leads'),
        title: 'Your leads',
        description: 'All your leads — from every channel — in one place.',
        side: 'left',
        align: 'start',
      },
      {
        element: eduSel('copilot-trigger'),
        title: 'Smart Assistant',
        description: 'Ask what to do next. Shortcut: ⌘J.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'pipeline',
    version: 1,
    auto: true,
    steps: [
      {
        element: eduSel('leads-table'),
        title: 'Your leads, in one place.',
        description: 'Who needs attention, and what to do next.',
        side: 'top',
        align: 'center',
      },
      {
        element: eduSel('lead-status-tabs'),
        title: 'Status',
        description: 'New, in progress, closed — so you know who to return to.',
        side: 'bottom',
        align: 'start',
      },
      {
        element: eduSel('leads-add'),
        title: 'New lead',
        description: 'Add a lead by hand without leaving the list.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'lead',
    version: 1,
    auto: true,
    blockedByFirstLead: true,
    steps: [
      {
        element: eduSel('lead-status'),
        title: 'Lead status',
        description: 'Update after a call so nothing falls through.',
        side: 'bottom',
        align: 'start',
      },
      {
        element: eduSel('lead-followup'),
        title: 'Follow up',
        description: 'Set when to return — the system reminds you on time.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'copilot',
    version: 1,
    auto: true,
    requiresCopilot: true,
    steps: [
      {
        element: eduSel('copilot-trigger'),
        title: 'Smart Assistant',
        description: 'Ask who needs you now. It never sends messages without your approval.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'whatsapp',
    version: 1,
    auto: false,
    steps: [
      {
        element: eduSel('whatsapp-section'),
        title: 'WhatsApp',
        description: 'Connect WhatsApp here under Settings → Integrations.',
        side: 'left',
        align: 'start',
      },
      {
        element: eduSel('whatsapp-connect'),
        title: 'Connect',
        description: 'Start the WhatsApp connection from this button.',
        side: 'bottom',
        align: 'start',
      },
    ],
  },
  {
    id: 'facebook',
    version: 1,
    auto: false,
    steps: [
      {
        element: eduSel('facebook-section'),
        title: 'Facebook',
        description: 'Connect Facebook here under Settings → Integrations.',
        side: 'left',
        align: 'start',
      },
      {
        element: eduSel('facebook-connect'),
        title: 'Connect',
        description: 'Start the Facebook connection from this button.',
        side: 'bottom',
        align: 'start',
      },
    ],
  },
]

const BY_ID = new Map(TOURS.map((t) => [t.id, t]))

export function getTour(id: TourId): TourDefinition | undefined {
  return BY_ID.get(id)
}

export function isTourId(value: string | null | undefined): value is TourId {
  return !!value && BY_ID.has(value as TourId)
}

export function allTours(): TourDefinition[] {
  return TOURS
}
