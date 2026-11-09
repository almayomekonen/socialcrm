import { describe, expect, it, vi } from 'vitest'
import { HarnessRefused } from '../live/quote/safety'
import { BROWSER_BUDGET_MS, MIN_START_GAP_MS, NO_RESPONSE_CHARGE_MS, createRenderLimiter } from '../live/cloud/renderLimit'

/** The Workers Free walls of the cloud harness, on a fake clock unless a case needs a real timer. */

const ACCOUNT = 'a'.repeat(32)
const URL_PDF = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run/pdf?cacheTTL=0`
const GAP = MIN_START_GAP_MS
const usage = (value: string | null, status = 200) => new Response('ok', { status, headers: value === null ? {} : { 'X-Browser-Ms-Used': value } })

function setup(respond: () => Promise<Response> = async () => usage('1000'), limits = { maxRenders: 20, maxRetries: 3 }) {
  const clock = { t: 0 }
  const starts: number[] = []
  const inner = vi.fn(async (_input: unknown, _init?: RequestInit) => {
    starts.push(clock.t)
    return respond()
  })
  const sleep = vi.fn(async (ms: number) => void (clock.t += ms))
  const l = createRenderLimiter({ inner: inner as never, accountId: ACCOUNT, limits, now: () => clock.t, sleep })
  const send = (body: string, signal?: AbortSignal) => l.fetch(URL_PDF, { method: 'POST', body, signal })
  return { clock, starts, inner, sleep, l, send }
}

describe('pacing', () => {
  it('the first request leaves at once, and each later one 11 seconds after the last start', async () => {
    const { starts, sleep, send, l } = setup()
    for (const b of ['a', 'b', 'c']) await send(b)
    expect(starts).toEqual([0, GAP, 2 * GAP])
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(l.state.minStartGapMs).toBe(GAP)
  })
  it('time already passed is not waited again, and start to start is what counts', async () => {
    const { clock, starts, sleep, send } = setup()
    await send('a')
    clock.t += 4000
    await send('b')
    expect(sleep).toHaveBeenCalledWith(GAP - 4000, undefined)
    expect(starts[1]).toBe(GAP)
  })
  it('a retry of the same body waits like any other request and counts as a retry', async () => {
    const { starts, send, l } = setup(async () => usage('1000', 429))
    await send('a')
    await send('a')
    expect(starts).toEqual([0, GAP])
    expect(l.state).toMatchObject({ requests: 2, retries: 1 })
  })
  it('a timer that fires early waits out the rest', async () => {
    const { clock, starts, sleep, send } = setup()
    await send('a')
    sleep.mockImplementationOnce(async () => void (clock.t += 2000))
    await send('b')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([GAP, GAP - 2000])
    expect(starts[1]).toBe(GAP)
  })
  it('concurrent requests never share a slot', async () => {
    const { starts, send, l } = setup()
    await Promise.all(['a', 'b', 'c', 'd'].map((b) => send(b)))
    const gaps = starts.slice(1).map((s, i) => s - starts[i])
    expect(starts).toHaveLength(4)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(GAP)
    expect(l.state.minStartGapMs).toBeGreaterThanOrEqual(GAP)
  })
  it('a request over a limit is refused without waiting', async () => {
    const { inner, sleep, send } = setup(undefined, { maxRenders: 1, maxRetries: 0 })
    await send('a')
    await expect(send('b')).rejects.toBeInstanceOf(HarnessRefused)
    expect(sleep).not.toHaveBeenCalled()
    expect(inner).toHaveBeenCalledTimes(1)
  })
  it('a limit used up during the wait still refuses the waiter', async () => {
    const { inner, send, l } = setup(undefined, { maxRenders: 2, maxRetries: 0 })
    const results = await Promise.allSettled(['a', 'b', 'c'].map((b) => send(b)))
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'fulfilled', 'rejected'])
    expect(inner).toHaveBeenCalledTimes(2)
    expect(l.state).toMatchObject({ requests: 2, refused: 1, stopped: true })
  })
  it('other hosts and refused paths never wait', async () => {
    const { inner, sleep, send, l } = setup()
    await send('a')
    await l.fetch(`https://${ACCOUNT}.r2.cloudflarestorage.com/b/k`)
    await expect(l.fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/tokens`, {})).rejects.toBeInstanceOf(HarnessRefused)
    expect(sleep).not.toHaveBeenCalled()
    expect(inner).toHaveBeenCalledTimes(2)
  })
})

describe('aborts', () => {
  it('already aborted: rejected with its reason, not counted, and no slot used', async () => {
    const { inner, starts, send, l } = setup()
    const reason = new DOMException('gone', 'AbortError')
    await expect(send('a', AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(inner).not.toHaveBeenCalled()
    expect(l.state).toMatchObject({ requests: 0, browserMs: 0, unmeasured: 0 })
    await send('a')
    expect(starts).toEqual([0])
    expect(l.state).toMatchObject({ requests: 1, retries: 0 })
  })
  it('aborted during the wait, on the real timer: rejected at once with a timeout the renderer classifies', async () => {
    const inner = vi.fn(async () => usage('1000'))
    const l = createRenderLimiter({ inner: inner as never, accountId: ACCOUNT, limits: { maxRenders: 3, maxRetries: 0 } })
    await l.fetch(URL_PDF, { method: 'POST', body: 'a' })
    const at = performance.now()
    const err = await l.fetch(URL_PDF, { method: 'POST', body: 'b', signal: AbortSignal.timeout(20) }).catch((e: unknown) => e)
    expect((err as DOMException).name).toBe('TimeoutError')
    expect(performance.now() - at).toBeLessThan(2000)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(l.state).toMatchObject({ requests: 1, browserMs: 1000, unmeasured: 0 })
  })
  it('the caller\'s signal reaches the request, on a Request object too', async () => {
    const { inner, send, l, clock } = setup()
    const c = new AbortController()
    await send('a', c.signal)
    expect(inner.mock.calls[0][1]?.signal).toBe(c.signal)
    clock.t += GAP
    const aborted = new AbortController()
    aborted.abort(new DOMException('gone', 'AbortError'))
    await expect(l.fetch(new Request(URL_PDF, { method: 'POST', body: 'b', signal: aborted.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(inner).toHaveBeenCalledTimes(1)
  })
  it('after waitForSlot a 1ms timeout created next is still live when the request leaves', async () => {
    const seen: boolean[] = []
    const { sleep, send, l, inner } = setup()
    await send('a')
    await l.state.waitForSlot()
    expect(sleep).toHaveBeenCalledTimes(1)
    inner.mockImplementationOnce(async (_input, init) => {
      seen.push(Boolean(init?.signal?.aborted))
      return usage('5')
    })
    await send('b', AbortSignal.timeout(1))
    expect(seen).toEqual([false])
    expect(sleep).toHaveBeenCalledTimes(1)
  })
  it('waitForSlot does not use the slot, and does not wait once the run has stopped', async () => {
    const { sleep, send, l, starts } = setup(undefined, { maxRenders: 2, maxRetries: 0 })
    await l.state.waitForSlot()
    expect(sleep).not.toHaveBeenCalled()
    await send('a')
    await l.state.waitForSlot()
    await send('b')
    expect(starts).toEqual([0, GAP])
    await expect(send('c')).rejects.toBeInstanceOf(HarnessRefused)
    sleep.mockClear()
    await l.state.waitForSlot()
    expect(sleep).not.toHaveBeenCalled()
  })
  it('no response at all charges the 60-second maximum: the browser may have run on', async () => {
    const { send, l } = setup(async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    await expect(send('a')).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(l.state).toMatchObject({ requests: 1, browserMs: NO_RESPONSE_CHARGE_MS, unmeasured: 1, reportedResponses: 0 })
  })
})

describe('browser time', () => {
  it('adds up each response\'s own reported time, whatever the header\'s case', async () => {
    let n = 0
    const { send, l } = setup(async () => new Response('ok', { headers: { 'x-browser-MS-used': n++ ? '2500.5' : '1500' } }))
    await send('a')
    await send('b')
    expect(l.state).toMatchObject({ browserMs: 4000.5, reportedResponses: 2, unmeasured: 0 })
  })
  it('a reported zero on a refused request is taken as reported', async () => {
    const { send, l } = setup(async () => usage('0', 401))
    await send('a')
    expect(l.state).toMatchObject({ browserMs: 0, reportedResponses: 1, unmeasured: 0 })
  })
  it.each([
    ['missing', null, 200],
    ['empty', '', 200],
    ['text', 'abc', 200],
    ['negative', '-5', 200],
    ['exponent', '1e3', 200],
    ['with a unit', '12ms', 200],
    ['not finite', 'Infinity', 200],
    ['too large to be a number', '9'.repeat(400), 200],
    ['zero on a successful render', '0', 200],
    ['missing on a rate limit', null, 429],
  ])('%s: the request\'s wall clock is charged and it is marked unmeasured', async (_what, value, status) => {
    const holder: { clock?: { t: number } } = {}
    const made = setup(async () => {
      holder.clock!.t += 3000
      return usage(value as string | null, status as number)
    })
    holder.clock = made.clock
    await made.send('a')
    expect(made.l.state).toMatchObject({ browserMs: 3000, unmeasured: 1, reportedResponses: 0, stopped: false })
  })
})

describe('the 300-second budget', () => {
  it('just under the budget, the next request still leaves', async () => {
    const { inner, send, l } = setup(async () => usage(String(BROWSER_BUDGET_MS - 1)))
    await send('a')
    expect(l.state).toMatchObject({ stopped: false, stopReason: null })
    await send('b')
    expect(inner).toHaveBeenCalledTimes(2)
  })
  it('reaching it returns that response, then refuses everything without waiting and stays stopped', async () => {
    const { inner, sleep, send, l } = setup(async () => usage(String(BROWSER_BUDGET_MS)))
    expect((await send('a')).ok).toBe(true)
    expect(l.state).toMatchObject({ stopped: true, stopReason: 'browser_budget', browserMs: BROWSER_BUDGET_MS })
    await expect(send('b')).rejects.toThrow('browser-time budget')
    await expect(send('c')).rejects.toBeInstanceOf(HarnessRefused)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(l.state).toMatchObject({ refused: 2, stopReason: 'browser_budget' })
  })
  it('charges add up to it: five requests with no response use the whole budget', async () => {
    const { inner, send, l } = setup(async () => {
      throw new TypeError('network')
    })
    for (const b of ['a', 'b', 'c', 'd', 'e']) await expect(send(b)).rejects.toBeInstanceOf(TypeError)
    expect(l.state).toMatchObject({ browserMs: BROWSER_BUDGET_MS, stopReason: 'browser_budget', unmeasured: 5 })
    await expect(send('f')).rejects.toThrow('browser-time budget')
    expect(inner).toHaveBeenCalledTimes(5)
  })
  it('a retry is refused by the budget too', async () => {
    const { send, l } = setup(async () => usage(String(BROWSER_BUDGET_MS), 429))
    await send('a')
    await expect(send('a')).rejects.toThrow('browser-time budget')
    expect(l.state.retries).toBe(0)
  })
  it('hitting the render limit reports that limit, not the budget', async () => {
    const { send, l } = setup(undefined, { maxRenders: 1, maxRetries: 0 })
    await send('a')
    await expect(send('b')).rejects.toThrow('render or retry limit')
    expect(l.state).toMatchObject({ stopReason: 'limit', stopped: true })
  })
})
