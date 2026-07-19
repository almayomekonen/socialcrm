import type { ReactElement } from 'react'
import type { Automation, Recipient } from './types'
import type { ContentItem } from './content/types'
import { ContentEmail } from '@/emails/components/ContentEmail'
import { appUrl, unsubscribeUrlFor } from './config'

// Render a content item for a recipient through the single ContentEmail renderer.
// The unsubscribe footer is included only for lifecycle emails (transactional
// ones — trial, welcome — never show it), preserving existing behavior.
export function renderContentItem(item: ContentItem, r: Recipient): ReactElement {
  return ContentEmail({
    item,
    recipient: r,
    ctaUrl: appUrl(item.cta.route),
    unsubscribeUrl: item.category === 'lifecycle' ? unsubscribeUrlFor(r.userId) : undefined,
  })
}

// Map a state/event content item to the existing Automation shape. Educational
// (schedule.kind === 'step') items are NOT mapped here — they are delivered by
// the single dynamic educational-journey drip (see registry.ts), so progression
// is derived from delivered emails rather than a fixed per-item schedule.
export function contentToAutomation(item: ContentItem): Automation {
  const base = {
    key: item.key,
    enabled: item.enabled ?? true,
    priority: item.priority,
    order: 0, // state-triggered + event items outrank the educational drip
    category: item.category,
    subject: () => item.subject,
    template: (r: Recipient) => renderContentItem(item, r),
    gate: item.gate,
  }

  if (item.schedule.kind === 'event') {
    return { ...base, trigger: 'event', event: item.schedule.event }
  }
  if (item.schedule.kind === 'condition') {
    return { ...base, trigger: 'scheduled', audience: item.audience, condition: item.condition }
  }
  throw new Error(`contentToAutomation: educational 'step' items are delivered by the drip, not mapped (key=${item.key})`)
}
