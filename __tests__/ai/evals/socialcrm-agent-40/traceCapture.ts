/**
 * LATENCY, TAKEN FROM THE RUNTIME'S OWN TRACE.
 *
 * `runAgentInvestigation` measures model wait, tool wall time, tool calls and
 * round trips, and emits them on `GENERATION_COMPLETE` / `GENERATION_FAILED`.
 * It does not RETURN them, and this phase is not allowed to add capabilities to
 * the agent to make it do so — so the harness reads the trace line instead.
 *
 * The trace is already a stable, prefixed, JSON-per-line contract used for
 * production observability. Parsing it here costs the agent nothing and changes
 * no behaviour, which is exactly what an evaluation harness should cost.
 *
 * `modelWaitMs` is DERIVED by the runtime (generation time minus tool time), not
 * measured against the provider — reported as the runtime defines it, so the
 * number in the report means the same thing as the number in production logs.
 */
export type TraceTimings = {
  modelWaitMs: number | null
  toolWallMs: number | null
  toolCalls: number | null
  toolRoundTrips: number | null
  steps: number | null
  finishReason: string | null
}

const EMPTY: TraceTimings = { modelWaitMs: null, toolWallMs: null, toolCalls: null, toolRoundTrips: null, steps: null, finishReason: null }

const PREFIX = '[AGENT-TRACE] '
const STAGES = ['GENERATION_COMPLETE', 'GENERATION_FAILED']

/**
 * Capture trace lines for the duration of one investigation.
 *
 * Returns a handle whose `stop()` yields the timings of the LAST generation
 * record seen. Last rather than first because a run that failed over to a second
 * provider emits one per attempt, and the attempt that produced the answer is
 * the one the latency belongs to.
 *
 * The original `console.log` is always restored, including when the
 * investigation throws — an evaluation that silently swallows the process's
 * logging would be worse than no evaluation.
 */
export function captureTrace(): { stop: () => TraceTimings } {
  const original = console.log
  let last: TraceTimings = EMPTY

  console.log = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.startsWith(PREFIX) && STAGES.some((s) => first.includes(s))) {
      const brace = first.indexOf('{')
      if (brace !== -1) {
        try {
          const rec = JSON.parse(first.slice(brace)) as Record<string, unknown>
          const num = (k: string) => (typeof rec[k] === 'number' ? (rec[k] as number) : null)
          last = {
            modelWaitMs: num('modelWaitMs'),
            toolWallMs: num('toolWallMs'),
            toolCalls: num('toolCalls'),
            toolRoundTrips: num('toolRoundTrips'),
            steps: num('steps'),
            finishReason: typeof rec.finishReason === 'string' ? rec.finishReason : null,
          }
        } catch {
          // A malformed trace line is an observability defect, not an
          // evaluation failure. The case still reports its own wall clock.
        }
      }
    }
    original(...(args as []))
  }

  return {
    stop: () => {
      console.log = original
      return last
    },
  }
}
