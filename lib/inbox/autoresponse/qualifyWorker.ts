/**
 * The qualify turn's ORCHESTRATOR: the gates and the order of decisions.
 *
 *   qualifyTurn/turnFacts.ts     what the turn is decided on (transcript, ownership, classification)
 *   qualifyTurn/responders.ts    the greeting and the courtesy reply
 *   qualifyTurn/plan.ts          the decision order: pre-generation gate, deterministic
 *                                turns, conversation control, GPT eligibility
 *   (this file)                  kill switch, then carrying out the plan's effects
 *   qualifyTurn/generateTurn.ts  the model call, validation, repair, truthfulness check
 *   qualifyTurn/completeTurn.ts  the post-generation decision; draft / escalate / continue
 *   qualifyTurn/effects.ts       send + persist, shadow qualification, escalation record
 *
 * Every send still goes through sendIreOutbound (send-time gates) after
 * outboundGate(); nothing here or in the modules calls WhatsApp directly.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { skipAutoResponseJob, completeAutoResponseJob, skipPendingNoResponseJobs, type AutoResponseJob } from '@/db/autoResponseJobs'
import { markHumanActive, markStopped, markClosed } from '@/db/conversationAiState'
import { isQualifierEnabled } from './killSwitch'
import { waTrace } from './waTrace'
import { conversationCloser } from './conversationControl'
import { runImmediateHumanHandoff } from './immediateHandoff'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { sendDeterministicTurn } from './reliability/deterministicTurn'
import type { Outcome, QualifyCtx, QualifyDeps } from './qualifyTurn/types'
import { readTurnFacts } from './qualifyTurn/turnFacts'
import { planQualifyTurn } from './qualifyTurn/plan'
import { turnResponders } from './qualifyTurn/responders'
import { generateValidatedTurn, prepareGeneration } from './qualifyTurn/generateTurn'
import { completeQualifyTurn } from './qualifyTurn/completeTurn'
import { sendAndPersist } from './qualifyTurn/effects'

export type { QualifyCtx, QualifyDeps } from './qualifyTurn/types'


export async function processQualifyJob(job: AutoResponseJob, ctx: QualifyCtx, deps: QualifyDeps): Promise<Outcome> {
  const { settings, conv, lead, master } = ctx
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_skipped',
      props: { conversationId: conv.id, reason, mode: 'qualify' },
    })
    return 'skipped'
  }

  // Global backstop (env). Per-agency instant levers are the DB flags.
  if (isQualifierEnabled() === false) return doSkip('qualifier_killed')
  // Ownership + silence correctness (reliability/*), per agency.
  const reliability = canUseAgentReliability(job.agencyId)

  const facts = await readTurnFacts({ job, ctx, reliability })
  const { aiState, lastInboundText, lang } = facts
  const base = { job, ctx, deps, doSkip, reliability }
  const { resolveGreeting, attemptCourtesy } = turnResponders({ ...base, ...facts })
  const traceCtx = { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }

  // The decision order lives in qualifyTurn/plan.ts (shared with the owner's
  // simulator). Each plan is carried out here exactly as before.
  const plan = await planQualifyTurn({
    facts,
    settings,
    master,
    reliability,
    jobCreatedAt: job.createdAt,
    nowMs: Date.now(),
    resolveGreeting,
    trace: (event, data) => waTrace(event, traceCtx, data),
  })

  switch (plan.kind) {
    case 'courtesy': {
      const courtesyOutcome = await attemptCourtesy({ closeAfter: plan.closeAfter })
      return courtesyOutcome ?? doSkip('courtesy_unavailable')
    }
    case 'stop':
      if (plan.state === 'human_active') await markHumanActive(conv.id)
      else await markStopped(conv.id, 'opted_out', plan.reason)
      return doSkip(plan.reason)
    case 'skip':
      return doSkip(plan.reason)
    case 'handoff': {
      const gate = facts.outboundGate()
      if (gate.allowed === false) return doSkip(gate.reason)
      return runImmediateHumanHandoff({
        job,
        ctx,
        send: deps.send,
        aiState,
        lastInboundText,
        greetingLine: (await resolveGreeting()).line,
      })
    }
    case 'deterministic': {
      const gate = facts.outboundGate()
      if (gate.allowed === false) return doSkip(gate.reason)
      return sendDeterministicTurn({
        job,
        ctx,
        send: deps.send,
        turn: plan.turn,
        skip: async (reason) => {
          await doSkip(reason)
          return 'skipped'
        },
      })
    }
    case 'close_silence': {
      const courtesyOutcome = await attemptCourtesy({ closeAfter: plan.reason })
      if (courtesyOutcome) return courtesyOutcome
      await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
      await markClosed(conv.id, plan.reason)
      return doSkip(`closed_${plan.reason}`)
    }
    case 'closer': {
      const gate = facts.outboundGate()
      if (gate.allowed === false) return doSkip(gate.reason)
      // Deliberately NOT greeted. A closer is sent when the customer declined,
      // said goodbye, or confirmed they are done. "Welcome to X 👋 No problem,
      // thanks." welcomes someone out of the door, which reads worse than no
      // welcome at all. The greeting belongs on a reply that opens a
      // conversation, including a handoff — not on one that ends it.
      const r = await sendAndPersist(job, ctx, deps.send, conversationCloser(lang))
      if (r.ok === false) {
        if (r.settled) return 'failed'
        return doSkip(r.reason)
      }
      await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
      await markClosed(conv.id, plan.reason)
      await completeAutoResponseJob(job.id, r.messageId)
      await track({
        agencyId: job.agencyId,
        event: 'auto_response_sent',
        props: { conversationId: conv.id, reason: `closed_${plan.reason}` },
      })
      return 'sent'
    }
    case 'generate': {
      const { gptEligibility, inboundTexts, deferredMeeting } = plan
      const prepared = await prepareGeneration({ ...base, ...facts, resolveGreeting, attemptCourtesy, gptEligibility, inboundTexts })
      const generated = await generateValidatedTurn({ ...base, ...facts, ...prepared })
      if ('done' in generated) return generated.done
      return completeQualifyTurn({ ...base, ...facts, ...prepared, ...generated, deferredMeeting })
    }
  }
}
