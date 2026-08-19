import { describe, expect, it } from 'vitest'
import { readyMessageTitle } from '@/modules/templates/mobile/readyMessageTitle'

describe('readyMessageTitle — presentation only', () => {
  it('maps the known Meta slug lead_first_contact by its product meaning', () => {
    expect(readyMessageTitle('lead_first_contact')).toBe('יצירת קשר ראשוני')
  })

  it('passes owner-authored Hebrew titles through unchanged', () => {
    expect(readyMessageTitle('תזכורת פולואפ')).toBe('תזכורת פולואפ')
  })

  it('does not leak an unknown snake_case identifier', () => {
    expect(readyMessageTitle('some_meta_slug')).toBe('הודעה מוכנה')
  })

  it('treats ready_message_2 as the slugify fallback, not a new meaning', () => {
    expect(readyMessageTitle('ready_message_2')).toBe('הודעה מוכנה')
  })
})
