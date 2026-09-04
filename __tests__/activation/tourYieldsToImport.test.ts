import { describe, it, expect } from 'vitest'
import { pipelineYieldsToFirstImport, copilotYieldsToLead, copilotYieldsToPipeline } from '@/lib/education'

/**
 * The Driver.js collision.
 *
 * Driver.js paints a full-viewport SVG with a cutout around the element it
 * highlights; everything outside that cutout is covered and unclickable. The
 * pipeline tour highlights the leads TABLE, and the first-import banner sits
 * ABOVE it — so the moment an import flipped `hasLeads` to true, the tour's
 * overlay landed on top of `פתח את הליד הראשון`, the single control the whole
 * activation loop depends on. `document.elementFromPoint` at the CTA's centre
 * returned Driver's overlay, not the button.
 *
 * The fix reuses the rule the education system already has: an activation
 * handoff in progress outranks an educational tour, exactly as the copilot tour
 * yields to the first-lead flow.
 */
describe('pipelineYieldsToFirstImport', () => {
  it('yields while an import handoff is on screen', () => {
    expect(pipelineYieldsToFirstImport(3)).toBe(true)
    expect(pipelineYieldsToFirstImport(1)).toBe(true)
  })

  it('does not yield on an ordinary /leads visit', () => {
    expect(pipelineYieldsToFirstImport(0)).toBe(false)
  })

  it('treats a missing/zero count as no handoff, so tours are preserved elsewhere', () => {
    // The page passes `Number(params.firstImport) || 0`, so a malformed param
    // arrives here as 0 and must NOT suppress the tour.
    expect(pipelineYieldsToFirstImport(Number(undefined) || 0)).toBe(false)
    expect(pipelineYieldsToFirstImport(Number('nope') || 0)).toBe(false)
  })

  it('is a DEFERRAL: the same input without the handoff re-enables the tour', () => {
    // The banner strips its one-shot params on dismiss/act, so the next render
    // passes 0 and the tour becomes eligible again. It was never started, so it
    // was never recorded as settled.
    const duringHandoff = pipelineYieldsToFirstImport(3)
    const afterDismiss = pipelineYieldsToFirstImport(0)
    expect(duringHandoff).toBe(true)
    expect(afterDismiss).toBe(false)
  })
})

describe('the existing yield rules are unchanged', () => {
  it('copilot still yields to an unsettled pipeline on /leads', () => {
    expect(copilotYieldsToPipeline('/leads', false)).toBe(true)
    expect(copilotYieldsToPipeline('/leads', true)).toBe(false)
    expect(copilotYieldsToPipeline('/dashboard', false)).toBe(false)
  })

  it('copilot still yields to an active first-lead flow', () => {
    expect(copilotYieldsToLead('/clients/1/summary', true, true)).toBe(true)
    expect(copilotYieldsToLead('/clients/1/summary', true, false)).toBe(false)
    expect(copilotYieldsToLead('/leads', true, true)).toBe(false)
  })
})
