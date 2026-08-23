/**
 * WhatsApp Agent — cancel an in-flight generation when the human takes presence.
 *
 * This is the "cancel where possible" half of the safety model. It polls
 * presence while the model is running and aborts the provider call the moment a
 * rep starts typing, so we stop paying for — and stop waiting on — a reply that
 * can no longer be sent.
 *
 * IT IS AN OPTIMISATION, NOT THE GUARANTEE. Cancellation is best-effort: the
 * provider may already have returned, the abort may lose the race, the poll may
 * be mid-flight. The guarantee lives at the outbound boundary
 * (agentSendGuard.ts), which re-reads presence after generation and refuses the
 * send regardless of whether anything here fired. If this whole module were
 * deleted, no AI reply would reach a customer after typing began — it would just
 * be generated wastefully first.
 */
import { readHumanPresence } from '@/db/conversationHumanPresence'
import { HUMAN_PRESENCE_POLL_MS, shouldCancelGeneration } from './humanPresence'
import { waTrace, type WaTraceCtx } from './waTrace'

/** Longest an unattended watch may keep polling. Far beyond any real generation. */
const DEFAULT_MAX_WATCH_MS = 120_000

export type HumanPresenceWatch = {
  /** Pass to the AI call. Aborts as soon as a human is detected. */
  signal: AbortSignal
  /** True once the watch has aborted because a human took presence. */
  cancelled: () => boolean
  /** Always call from a finally block — stops the poll and releases the timer. */
  stop: () => void
}

export function watchHumanPresence(args: {
  conversationId: number
  /** Turn epoch — the job's `createdAt`. */
  turnStartedAt: string
  trace?: WaTraceCtx
  intervalMs?: number
  /** Self-terminates after this long, so a watch can never outlive its turn. */
  maxDurationMs?: number
  read?: typeof readHumanPresence
}): HumanPresenceWatch {
  const controller = new AbortController()
  const read = args.read ?? readHumanPresence
  let cancelled = false
  let stopped = false
  let inFlight = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    clearTimeout(deadline)
  }

  const tick = async (): Promise<void> => {
    // One read at a time. A slow database must not queue up polls behind itself.
    if (inFlight || stopped) return
    inFlight = true
    try {
      const facts = await read(args.conversationId)
      if (stopped || cancelled) return
      if (!shouldCancelGeneration(facts, args.turnStartedAt)) return
      cancelled = true
      waTrace('GENERATION_CANCELLED_HUMAN_PRESENCE', args.trace ?? {}, {
        aiState: facts.aiState,
        humanTypingAt: facts.humanTypingAt,
        humanTypingUntil: facts.humanTypingUntil,
        turnStartedAt: args.turnStartedAt,
      })
      stop()
      controller.abort(new Error('human_presence'))
    } catch {
      // A failed presence read must never abort a generation on its own — the
      // outbound guard fails closed for us, and it is the authority.
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(() => void tick(), Math.max(250, args.intervalMs ?? HUMAN_PRESENCE_POLL_MS))
  // Belt and braces against a caller that returns without stopping: the poll
  // expires on its own rather than outliving the turn it belongs to.
  const deadline = setTimeout(stop, Math.max(1_000, args.maxDurationMs ?? DEFAULT_MAX_WATCH_MS))
  // Never hold a process open for a watcher whose generation already finished.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  ;(deadline as unknown as { unref?: () => void }).unref?.()

  return { signal: controller.signal, cancelled: () => cancelled, stop }
}
