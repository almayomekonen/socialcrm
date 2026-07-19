import { describe, it, expect } from 'vitest'
import { renderEmail } from '@/lib/email/render'
import { renderContentItem } from '@/lib/emailAutomations/contentToAutomation'
import { STATE_CONTENT } from '@/lib/emailAutomations/content/state'
import { EDUCATIONAL } from '@/lib/emailAutomations/content/educational'
import { TESTIMONIALS, TESTIMONIAL_SOURCE } from '@/lib/emailAutomations/testimonials'
import type { ContentItem, ContentBlock } from '@/lib/emailAutomations/content/types'
import type { Recipient } from '@/lib/emailAutomations/types'

const recipient: Recipient = { userId: 7, agencyId: 7, email: 'a@b.com', firstName: 'דוד' }
const html = (item: ContentItem) => renderEmail(renderContentItem(item, recipient))

describe('migrated state content renders through ContentEmail', () => {
  for (const item of STATE_CONTENT) {
    it(`${item.key}: renders headline + CTA`, async () => {
      const out = await html(item)
      expect(out).toContain(item.headline)
      expect(out).toContain(item.cta.label)
    })

    it(`${item.key}: unsubscribe footer matches its category (${item.category})`, async () => {
      const out = await html(item)
      if (item.category === 'lifecycle') {
        expect(out).toContain('הסרה מרשימת התפוצה')
        expect(out).toContain('/api/email/unsubscribe?u=7')
      } else {
        expect(out).not.toContain('הסרה מרשימת התפוצה')
      }
    })
  }
})

describe('educational sequence', () => {
  it('every item renders with headline, CTA and the lifecycle unsubscribe footer', async () => {
    for (const item of EDUCATIONAL) {
      const out = await html(item)
      expect(out).toContain(item.headline)
      expect(out).toContain(item.cta.label)
      expect(out).toContain('הסרה מרשימת התפוצה') // all educational items are lifecycle
    }
  })

  it('uses only real testimonial quotes, attributed to the universal source', async () => {
    const realQuotes = Object.values(TESTIMONIALS).map((t) => t.quote)
    const withTestimonial = EDUCATIONAL.filter((i) => i.blocks.some((b) => b.type === 'testimonial'))
    expect(withTestimonial.length).toBe(3)
    for (const item of withTestimonial) {
      const block = item.blocks.find((b) => b.type === 'testimonial') as Extract<ContentBlock, { type: 'testimonial' }>
      expect(realQuotes).toContain(block.quote) // never invented
      const out = await html(item)
      expect(out).toContain(block.quote)
      expect(out).toContain(TESTIMONIAL_SOURCE)
    }
  })
})
