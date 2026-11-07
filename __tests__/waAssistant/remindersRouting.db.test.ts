import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: production 2026-11-07, agency 103. "תזכיר להתקשר ל-לייה חדש בעוד 3
 * דקות" (no "לי") went to the Agent's lead/task flow, and the owner's correction
 * "לא משימה! תזכורת" was read as a task because it contains "משימה". With the
 * reminders switch on, an explicit reminder request is handled BEFORE the
 * CRM task/lead flows. Real database, real worker and webhook; model and Meta mocked.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { MIN, agencies, ask, card, harness, owner, reminders, reset, run, say, setEnv, teardown } from './reminderHarness'

let A: number
let OFF: number

beforeAll(async () => {
  ;[A, OFF] = await agencies('__rm_routing_a__', '__rm_routing_off__')
})
beforeEach(async () => {
  await reset([A, OFF])
  setEnv([A], [OFF])
})
afterAll(async () => {
  await teardown()
})

describe('explicit reminder requests come before the CRM task/lead flows', () => {
  it.each([
    ['תזכיר לי להתקשר לאבי בעוד 5 דקות', 'להתקשר לאבי', 5],
    ['תזכיר להתקשר ללייה בעוד 3 דקות', 'להתקשר ללייה', 3],
    ['תזכיר להתקשר ל-לייה חדש בעוד 3 דקות', 'להתקשר ל-לייה חדש', 3],
  ])('%s → a reminder card, the Agent is never asked', async (words, text, minutes) => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, words)
    expect(c.body).toContain(`תזכורת: ${text}`)
    expect(h.runAgent).not.toHaveBeenCalled()
    const [draft] = await reminders(o)
    const job = (await db('wa_assistant_jobs').where({ recipientId: o.r }).first('messageTimestamp')) as { messageTimestamp: string }
    expect(new Date(draft.remindAt).getTime()).toBe(Number(job.messageTimestamp) * 1000 + minutes * MIN)
  })

  it('"לא משימה! תזכורת" turns the previous request into a reminder, timed from that request', async () => {
    const o = await owner(A)
    const h = harness()
    await say(o, 'תזכיר לדני בעוד 10 דקות על הפגישה') // a name after "תזכיר": not recognised, goes to the Agent
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await reminders(o)).toHaveLength(0)
    const opener = (await db('wa_assistant_jobs').where({ recipientId: o.r }).first('messageTimestamp')) as { messageTimestamp: string }

    const c = await card(o, h, 'לא משימה! תזכורת')
    expect(c.body).toContain('*לקבוע תזכורת?*')
    expect(c.body).toContain('תזכורת: לדני על הפגישה')
    expect(h.runAgent).toHaveBeenCalledTimes(1) // the correction never reaches the Agent
    const [draft] = await reminders(o)
    expect(new Date(draft.remindAt).getTime()).toBe(Number(opener.messageTimestamp) * 1000 + 10 * MIN)
  })

  it('a correction with no earlier request asks what to remind', async () => {
    const o = await owner(A)
    const h = harness()
    expect((await ask(o, h, 'לא משימה, תזכורת')).body).toBe(REMINDER_COPY.askText)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('a real CRM task request is still a task', async () => {
    const o = await owner(A)
    const h = harness()
    await say(o, 'תיצור משימה להתקשר לדני מחר')
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await reminders(o)).toHaveLength(0)
  })

  it('reminders switch off → unchanged: the Agent handles it', async () => {
    const o = await owner(OFF)
    const h = harness()
    await say(o, 'תזכיר להתקשר ללייה בעוד 3 דקות')
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await db('owner_personal_reminders').where({ agencyId: OFF })).toHaveLength(0)
  })
})
