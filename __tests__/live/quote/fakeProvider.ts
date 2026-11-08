/**
 * Self-test mode: an OpenAI Responses API stand-in at the fetch layer, so the
 * real Agent, tools, gates, runtime and budget all run with no key and no network.
 */

export type ScriptedTurn = { findName: string | null; proposal: Record<string, unknown> | null; headline: string }
export type FakeProvider = { fetch: typeof fetch; next: ScriptedTurn | null }

const usage = (chars: number) => ({ input_tokens: Math.ceil(chars / 3), output_tokens: 150, input_tokens_details: { cached_tokens: 0 } })
const envelope = (output: unknown[], chars: number) => new Response(JSON.stringify({ id: `resp_${Date.now()}`, created_at: Math.floor(Date.now() / 1000), model: 'gpt-5.6', output, usage: usage(chars) }), { status: 200, headers: { 'content-type': 'application/json' } })

export function createFakeProvider(): FakeProvider {
  const self: FakeProvider = {
    next: null,
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      const turn = self.next
      if (!turn) throw new Error('fake provider: no scripted turn')
      if (turn.findName && !body.includes('function_call_output')) {
        return envelope([{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'find_lead', arguments: JSON.stringify({ name: turn.findName }) }], body.length)
      }
      const text = JSON.stringify({ headline: turn.headline, claims: [], unknown: null, businessState: null, proposedAction: turn.proposal, proposedBatch: null })
      return envelope([{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], body.length)
    }) as typeof fetch,
  }
  return self
}
