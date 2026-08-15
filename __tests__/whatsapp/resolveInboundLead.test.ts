import { describe, expect, it } from 'vitest'
import { resolveInboundLeadDecision } from '@/lib/whatsapp/resolveInboundLead'

describe('resolveInboundLeadDecision', () => {
  it('isPersonal wins over a later CTWA click and over an existing lead match', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: true,
        leadId: null,
        matchingLeadIds: [10],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'personal' })
  })

  it('remembered leadId attaches and skips auto rules', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: 44,
        matchingLeadIds: [99],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'remembered_lead', leadId: 44 })
  })

  it('unique existing phone match auto-links', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [7],
        hasCtwaReferral: false,
      }),
    ).toEqual({ kind: 'auto_link', leadId: 7 })
  })

  it('multiple phone matches do not guess — stay contact', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [7, 8],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'contact' })
  })

  it('verified CTWA with no memory and no match auto-creates', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'auto_create_ctwa' })
  })

  it('ambiguous organic inbound stays a leadless conversation', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [],
        hasCtwaReferral: false,
      }),
    ).toEqual({ kind: 'contact' })
  })
})
