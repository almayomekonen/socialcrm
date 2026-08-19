import { afterEach, describe, expect, it } from 'vitest'
import {
  beginFirstLeadFlow,
  endFirstLeadFlow,
  isAnyFirstLeadFlowActive,
  isFirstLeadFlow,
  __resetFirstLeadFlowForTests,
} from '@/components/clients/firstLeadFlow'

afterEach(() => {
  __resetFirstLeadFlowForTests()
})

describe('first-lead latch vs other tours', () => {
  it('reports an active flow without a lead id so the lead tour can wait', () => {
    expect(isAnyFirstLeadFlowActive()).toBe(false)
    beginFirstLeadFlow(9)
    expect(isFirstLeadFlow(9)).toBe(true)
    expect(isAnyFirstLeadFlowActive()).toBe(true)
    endFirstLeadFlow(9)
    expect(isAnyFirstLeadFlowActive()).toBe(false)
  })
})
