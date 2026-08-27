import type { ExpectationKind } from './detectors/registry'
import type { NotificationType } from '@/lib/notifications/types'
import type { VigilanceClass } from '@/lib/ai/runtime/valueBar'

/**
 * Deterministic notification ownership — DA-001 §9.1 condition 13, made structural.
 *
 * The amendment permits an AI-originated notification only when it "does not
 * duplicate a fact an existing deterministic notification type already owns and
 * delivers." That is not prompt guidance and not a runtime lookup: it is a total,
 * compiler-enforced mapping declared here, one line per expectation.
 *
 * WHY IT LIVES AT THE INTEGRATION BOUNDARY AND NOT IN THE RUNTIME. `ExpectationKind`
 * is this layer's (`./detectors/registry`), `NotificationType` is the notification
 * engine's, and `lib/ai/runtime/*` imports neither — it depends only on its own
 * siblings and `@/db/ai/*`. Declaring this map inside the runtime would make the
 * ratified runtime import its own adapter and the notification engine, inverting
 * the layering into a cycle. So the map lives where both types are already in
 * scope, and the runtime's Value Bar receives the resolved boolean.
 *
 * The guarantee is split, deliberately and visibly:
 *   · the TYPE guarantee (no expectation may exist without an ownership verdict)
 *     is enforced here, by `Record<ExpectationKind, …>` and `tsc`;
 *   · the SEAM guarantee (an owned fact can never be surfaced) is enforced in the
 *     gate, by criterion C4, which no caller and no model can bypass.
 *
 * COMPLETENESS IS THE COMPILER'S JOB, exactly as in `./detectors/registry.ts` and
 * `lib/notifications/registry.ts`. Adding a member to `ExpectationKind` without a
 * line in BOTH records below fails `npx tsc --noEmit`. A new detector therefore
 * cannot reach production without someone answering "does a deterministic
 * notification already tell the rep this?" — which is the question DA-001 exists
 * to force.
 */

/**
 * Which deterministic notification type, if any, already owns each expectation.
 *
 * `followup.overdue` maps to the live notification type of the same name: it is
 * emitted every minute by `lib/notifications/followupTick.ts`, keyed
 * `followup.overdue:{agency}:lead:{id}:at:{ms}` — the same identity rule the
 * signal's own observation key uses. The rep is already told. AI stays silent.
 *
 * `null` means no deterministic type delivers this fact, and only then may the
 * Value Bar's novelty criterion pass.
 */
export const NOTIFICATION_OWNERSHIP: Record<ExpectationKind, NotificationType | null> = {
  'followup.overdue': 'followup.overdue',
  /**
   * NULL — and the reasoning matters, because `sla.approaching` and
   * `sla.breached` exist by NAME in the registry.
   *
   * Ownership here means "a deterministic type that actually DELIVERS this fact
   * today", not "a type name exists". Both sla.* entries are `enabled: false`
   * with no emitter and no predicate, so nothing tells a נציג their interested
   * ליד has gone quiet with nothing scheduled. `message.unanswered` cannot: it
   * clears the moment any outbound lands, including an auto-response.
   *
   * IF ANYONE EVER GIVES sla.* AN EMITTER, THIS ENTRY MUST CHANGE IN THE SAME
   * COMMIT — otherwise the AI begins duplicating a deterministic notification,
   * which Condition 13 exists to forbid.
   */
  'sla.open_loop': null,
  /**
   * OWNED by `message.unanswered`, and the honest answer even though it costs
   * this detector its voice.
   *
   * `lib/notifications/unansweredTick.ts` runs every minute and enqueues on
   * exactly this fact: open conversation, lead not closed/lost,
   * `lastDirection = 'inbound'`, inbound head older than 30 minutes, no outbound
   * after it. The rep is already told, so the AI must not say it again —
   * Condition 13, the same reasoning that silences `followup.overdue`.
   *
   * THE ONE CASE THE DETERMINISTIC TICK MISSES is deliberately NOT grounds to
   * claim ownership is absent. The tick clears on ANY outbound including an
   * auto-response, whereas this detector's `lastHumanOutboundAt` excludes the
   * auto-response marker — so an AI-acknowledged, human-unanswered conversation
   * signals here and is silent there. Ownership is declared per EXPECTATION, not
   * per instance; claiming `null` to capture that minority would license the AI
   * to duplicate the tick on the majority, which is the precise failure this
   * record exists to prevent.
   *
   * The signal still earns its keep without surfacing: it reaches M3–M6, feeds
   * the world model and lands in `ai_shadow_coverage`. If the tick is ever
   * changed to distinguish human from automated outbound, this entry must be
   * revisited in the same commit.
   */
  'conversation.unanswered': 'message.unanswered',
  /**
   * NULL — nothing deterministic tells a rep a customer pushed back. The
   * qualifier classified the turn and wrote it to
   * `conversation_turn_classification`, but that table has no emitter and no
   * notification type; `message.unanswered` cannot serve, because an objection
   * the AI answered leaves no unanswered inbound at all.
   */
  'conversation.objection': null,
  /**
   * NULL. `sla.approaching` / `sla.breached` remain `enabled: false` with no
   * emitter, and `message.unanswered` is the wrong shape twice over: it clears
   * on any outbound, and in a stall the last message is OURS — the customer is
   * not waiting on us, the exchange simply stopped.
   */
  'conversation.stalled': null,
}

/**
 * Which expectations may invoke the constitutional vigilance override, and as
 * what class. Declared, never computed, and never reachable from a model output.
 *
 * Being listed here is NOT a licence to surface: the override waives only
 * `cost_of_waiting` and `evidence_sufficiency`, and can never waive ownership —
 * so `followup.overdue` remains permanently silent despite being a genuine passed
 * deadline. That is the intended interaction, not a contradiction: the rep is not
 * being left in the dark, they are being told by the cheaper deterministic engine.
 */
export const VIGILANCE_CLASS: Record<ExpectationKind, VigilanceClass | null> = {
  'followup.overdue': 'passed_deadline',
  // A next step was owed and none was taken: a dropped commitment, not a passed
  // calendar date — nobody ever wrote a date down, which is the whole problem.
  'sla.open_loop': 'dropped_commitment',
  /**
   * `cadence_break` — the customer spoke and the exchange stopped. No date was
   * missed (`passed_deadline`) and nothing was promised (`dropped_commitment`);
   * what broke is the back-and-forth itself, which is precisely this class.
   *
   * As with `followup.overdue`, being classed here is not a licence to surface:
   * the override waives `cost_of_waiting` and `evidence_sufficiency` and can
   * never waive ownership, and `message.unanswered` owns this expectation above.
   */
  'conversation.unanswered': 'cadence_break',
  /**
   * NULL — vigilance is about something NOT happening. An objection is a thing
   * the customer DID: a live event, present in the record, with no elapsed
   * silence to be vigilant about. It must earn its surfacing on the ordinary
   * criteria, and the override is not available to it.
   */
  'conversation.objection': null,
  // The exchange had rhythm and it stopped. No date was missed and nothing was
  // promised — what broke is the back-and-forth, which is this class exactly.
  'conversation.stalled': 'cadence_break',
}

/** True when a deterministic notification type already delivers this fact. */
export function isOwnedByDeterministicNotification(expectation: ExpectationKind): boolean {
  return NOTIFICATION_OWNERSHIP[expectation] !== null
}

/** The declared vigilance class for an expectation, or null. */
export function vigilanceClassFor(expectation: ExpectationKind): VigilanceClass | null {
  return VIGILANCE_CLASS[expectation] ?? null
}
