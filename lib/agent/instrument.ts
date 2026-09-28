/**
 * Where an investigation's wall clock actually goes.
 *
 * The 40-question evaluation moved from 13.0s to 19.2s average when broad
 * questions started pairing `get_today_state` with `get_lead_health`, and the
 * trace could not say why: it recorded `steps`, which counts TOOL CALLS, and a
 * tool call is not a round trip. Two calls the model emits in one turn cost one
 * wait; two calls it emits in consecutive turns cost two. Those are the same
 * `steps: 2` and very different latency, so the number that mattered was the one
 * not being measured.
 *
 * This measures it, at the boundary, without touching a single tool file. A tool
 * is wrapped, not rewritten: same `description`, same `inputSchema`, same
 * `execute` semantics including its throws. Timing is recorded in a `finally`,
 * so a failing tool is still counted — a slow failure is exactly the case worth
 * seeing.
 *
 * SUM AND SPAN ARE BOTH KEPT, and the gap between them is the point. `sumMs` is
 * work performed; `wallMs` is time the rep waited for it. Under sequential
 * calls they converge; under parallel calls `sumMs` exceeds `wallMs` by the
 * overlap. That ratio is how "did parallelism actually happen" gets answered
 * from a production trace rather than from a hopeful prompt instruction.
 *
 * Observability only. Nothing here participates in a decision, and a throwing
 * clock cannot fail an investigation.
 */

export type ToolSpan = { tool: string; startedAt: number; endedAt: number }

export type ToolTimings = {
  record(span: ToolSpan): void
  spans(): ToolSpan[]
  /** Total tool work performed. Exceeds `wallMs` when calls overlapped. */
  sumMs(): number
  /** First tool start to last tool end — what the rep actually waited for. */
  wallMs(): number
  calls(): number
}

export function createToolTimings(): ToolTimings {
  const all: ToolSpan[] = []
  return {
    record(span) {
      all.push(span)
    },
    spans: () => [...all],
    sumMs: () => all.reduce((total, s) => total + Math.max(0, s.endedAt - s.startedAt), 0),
    wallMs() {
      if (all.length === 0) return 0
      return Math.max(...all.map((s) => s.endedAt)) - Math.min(...all.map((s) => s.startedAt))
    },
    calls: () => all.length,
  }
}

type ExecutableTool = { execute?: (...args: never[]) => Promise<unknown> }

/**
 * Wrap every tool's `execute` with a timer, preserving the tool otherwise.
 *
 * Returns a NEW object; the tools passed in are not mutated, so a caller that
 * did not ask for instrumentation is unaffected.
 */
export function instrumentTools<T extends Record<string, unknown>>(
  tools: T,
  timings: ToolTimings,
  now: () => number,
): T {
  const out: Record<string, unknown> = {}

  for (const [name, entry] of Object.entries(tools)) {
    const original = (entry as ExecutableTool)?.execute
    if (typeof original !== 'function') {
      out[name] = entry
      continue
    }

    out[name] = {
      ...(entry as object),
      execute: async (...args: never[]) => {
        const startedAt = now()
        try {
          return await original(...args)
        } finally {
          // A broken observer must never turn a healthy tool call into a failure.
          try {
            timings.record({ tool: name, startedAt, endedAt: now() })
          } catch {
            /* ignored by design */
          }
        }
      },
    }
  }

  return out as T
}
