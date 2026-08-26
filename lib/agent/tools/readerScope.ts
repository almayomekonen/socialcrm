import 'server-only'
import type { SessionlessScope } from '@/db/briefing'
import type { AgentScope } from '../types'

/**
 * The Agent's reader scope — the agency REQUIRED, never resolved from a session.
 *
 * WHY THIS EXISTS. The Agent runs on two entirely different doors: an interactive
 * server action with a session cookie, and the autonomous signal worker with none.
 * Every tool passed `{ user: { role }, gotPermIds }` and let the reader recover the
 * agency itself through `getAgencyId()` -> `getUser()`. That is correct on the first
 * door and fatal on the second: `getUser()` returns null on a cron path, and
 * `user.agencyId` threw before any reservation existed, dead-lettering four
 * production `sla.open_loop` observations.
 *
 * `AgentScope.agencyId` was already server-resolved and already sitting in the
 * closure — resolved from the session for a rep, and from the signal job's
 * CHECK-constrained tenant for an autonomous run. It was simply never handed down.
 * This does that, and the `SessionlessScope` return type makes the compiler refuse
 * a tool that forgets.
 *
 * NOT A WIDENING. The value is the same agency the reader would have derived on the
 * interactive path, and the model cannot reach it: tools close over `deps.scope`,
 * and no tool takes an agency argument. What changes is only WHERE the agency comes
 * from — a scope the server resolved, rather than an ambient request the autonomous
 * path does not have.
 */
export function readerScope(scope: AgentScope): SessionlessScope {
  return { user: { role: scope.role }, gotPermIds: scope.gotPermIds, agencyId: scope.agencyId }
}
