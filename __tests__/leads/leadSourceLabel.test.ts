import { describe, it, expect } from 'vitest'
import { leadSourceLabel, leadSourceChannel, inboundChannelFromSource } from '@/lib/leads/leadSourceLabel'

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

  it('website composite → אתר (never the connection row or submission id)', () => {
    // The exact production shape: contact_form_7:{connectionRowId}:{submissionId}
    const stored = 'contact_form_7:3:c1e76529-dddb-407a-b0a4-3110089b0da4'
    expect(leadSourceLabel(stored)).toBe('אתר')
    expect(leadSourceLabel(stored)).not.toContain('contact_form_7')
    expect(leadSourceLabel(stored)).not.toContain('c1e76529')
    expect(leadSourceLabel(stored)).not.toContain(':')
  })

  it('website label is the channel word, not the integration title', () => {
    // "האתר שלי" is the Connections-page name for a configured integration.
    // A lead source names the CHANNEL, alongside Facebook / WhatsApp.
    expect(leadSourceLabel('contact_form_7:1:abc')).toBe('אתר')
    expect(leadSourceLabel('contact_form_7:1:abc')).not.toBe('האתר שלי')
  })

  it('a hand-tagged אתר lead reads identically to an ingested one', () => {
    // 'אתר' is offered by the manual create form (types/lists.ts).
    expect(leadSourceLabel('אתר')).toBe('אתר')
    expect(leadSourceLabel('אתר')).toBe(leadSourceLabel('contact_form_7:9:xyz'))
  })

  it('known Hebrew non-channel value (ייבוא) is preserved', () => {
    expect(leadSourceLabel('ייבוא')).toBe('ייבוא')
  })

  it('unknown human/free-text source is preserved verbatim (not forced to ידני)', () => {
    expect(leadSourceLabel('לירון אובודנקו')).toBe('לירון אובודנקו')
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
    expect(leadSourceChannel('contact_form_7:3:c1e76529')).toBe('website')
    expect(leadSourceChannel('WhatsApp')).toBe('whatsapp')
    expect(leadSourceChannel('אתר')).toBe('website')
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

describe('the existing channels are untouched by the website addition', () => {
  // Regression fence: this change may only ADD a channel. Any drift in the
  // three that already shipped is a defect, not a refinement.
  it('Facebook and WhatsApp labels are byte-identical to before', () => {
    expect(leadSourceLabel('facebook:1557473805865751')).toBe('Facebook')
    expect(leadSourceLabel('whatsapp:wamid.HBgMOTcyNTM3NzM2NjM2FQIAEhgUM0FGMDBBNjZFNzA1RDA4Qzg5NjQA')).toBe('WhatsApp')
    expect(leadSourceLabel('instagram:1')).toBe('Instagram')
    expect(leadSourceLabel(null)).toBe('ידני')
  })

  it('inboundChannelFromSource still ignores website (no surface exists for it)', () => {
    expect(inboundChannelFromSource('facebook:123')).toBe('facebook')
    expect(inboundChannelFromSource('whatsapp:wamid.x')).toBe('whatsapp')
    expect(inboundChannelFromSource('contact_form_7:3:abc')).toBeNull()
  })
})
