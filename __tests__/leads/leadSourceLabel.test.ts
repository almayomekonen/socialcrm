import { describe, it, expect } from 'vitest'
import { leadSourceLabel, leadSourceChannel } from '@/lib/leads/leadSourceLabel'

describe('leadSourceLabel', () => {
  it('null / undefined / empty → ידני (existing fallback)', () => {
    expect(leadSourceLabel(null)).toBe('ידני')
    expect(leadSourceLabel(undefined)).toBe('ידני')
    expect(leadSourceLabel('')).toBe('ידני')
    expect(leadSourceLabel('   ')).toBe('ידני')
  })

  it('manual synonyms → ידני', () => {
    expect(leadSourceLabel('manual')).toBe('ידני')
    expect(leadSourceLabel('ידני')).toBe('ידני')
  })

  it('whatsapp plain + composite → WhatsApp (never the wamid)', () => {
    expect(leadSourceLabel('whatsapp')).toBe('WhatsApp')
    expect(leadSourceLabel('WhatsApp')).toBe('WhatsApp')
    expect(leadSourceLabel('whatsapp:wamid.HBgMNTQ1gUM0FGMDBBNjZFNza1RDA4Qzg5NjQA')).toBe('WhatsApp')
    expect(leadSourceLabel('whatsapp:wamid.HBg...')).not.toContain('wamid')
    expect(leadSourceLabel('whatsapp:wamid.HBg...')).not.toContain(':')
  })

  it('facebook plain + composite → Facebook (never the leadId)', () => {
    expect(leadSourceLabel('facebook')).toBe('Facebook')
    expect(leadSourceLabel('Facebook')).toBe('Facebook')
    expect(leadSourceLabel('facebook:123456789')).toBe('Facebook')
    expect(leadSourceLabel('facebook:123456789')).not.toContain('123456789')
  })

  it('instagram plain + composite → Instagram (explicit only)', () => {
    expect(leadSourceLabel('instagram')).toBe('Instagram')
    expect(leadSourceLabel('Instagram')).toBe('Instagram')
    expect(leadSourceLabel('instagram:123')).toBe('Instagram')
  })

  it('known Hebrew non-channel value (ייבוא) is preserved', () => {
    expect(leadSourceLabel('ייבוא')).toBe('ייבוא')
  })

  it('unknown human/free-text source is preserved verbatim (not forced to ידני)', () => {
    expect(leadSourceLabel('לירון אובודנקו')).toBe('לירון אובודנקו')
    expect(leadSourceLabel('אתר')).toBe('אתר')
    expect(leadSourceLabel('Referral')).toBe('Referral')
  })

  it('Instagram is NOT inferred from a facebook: source (no heuristics)', () => {
    expect(leadSourceLabel('facebook:987')).toBe('Facebook')
    expect(leadSourceLabel('facebook:987')).not.toBe('Instagram')
  })
})

describe('leadSourceChannel (style key)', () => {
  it('maps composites and plain values to the canonical channel', () => {
    expect(leadSourceChannel('whatsapp:wamid.x')).toBe('whatsapp')
    expect(leadSourceChannel('facebook:123')).toBe('facebook')
    expect(leadSourceChannel('instagram:1')).toBe('instagram')
    expect(leadSourceChannel('WhatsApp')).toBe('whatsapp')
    expect(leadSourceChannel('manual')).toBe('manual')
    expect(leadSourceChannel('ידני')).toBe('manual')
    expect(leadSourceChannel(null)).toBe('manual')
    expect(leadSourceChannel('')).toBe('manual')
  })

  it('unknown free text → null (falls back to the default/gray style)', () => {
    expect(leadSourceChannel('ייבוא')).toBeNull()
    expect(leadSourceChannel('לירון אובודנקו')).toBeNull()
  })
})
