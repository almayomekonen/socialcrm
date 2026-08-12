/**
 * LOCAL NOTIFICATION FIXTURE — development only.
 *
 * Builds a deterministic notification state so the whole stack can be verified by
 * hand end to end:
 *
 *   notifyEvent() → notification_jobs → worker → notifications
 *                 → /api/notifications/feed → NotificationContext
 *                 → toast → bell badge → dropdown → seen/read
 *
 * IT ADDS NO PRODUCTION EMITTER AND CHANGES NO BEHAVIOUR. Every row it creates
 * goes through the real `notifyEvent()` door and the real `runNotificationWorker()`
 * pass, so recipient resolution, channel policy, copy building and collapse are
 * the shipped ones. Nothing here fabricates a notification row, and nothing here
 * fabricates frontend state.
 *
 * TWO WRITES ARE FIXTURE-ONLY, and both are deliberate:
 *
 * 1. `user_presence` is backdated by `seed` to stage the "While you were away"
 *    scenario. In the product the feed poll is the single writer of that table
 *    (db/notifications/presence.ts); this script does not become a second writer
 *    in any shipped path — it only sets up a starting state a real absence would
 *    have produced.
 * 2. `reset` deletes notification rows. It touches ONLY the four notification
 *    tables — never `clients`, never `inbox_conversations`, never `users`.
 *
 * WHY TWO PHASES. A toast requires two things that cannot both be true for rows
 * created before the browser was open: the notification must be toast-eligible
 * (which needs presence ONLINE, and presence only becomes online once the app has
 * polled) and it must have been created after the tab mounted (the backlog gate,
 * which is what stops a morning's unread from firing twenty toasts at once). So
 * `seed` stages the backlog and `live` emits one notification while you watch.
 *
 * Usage (see the block printed by `help`):
 *   npx tsx scripts/notifications-fixture.ts seed
 *   npx tsx scripts/notifications-fixture.ts live
 *   npx tsx scripts/notifications-fixture.ts status
 *   npx tsx scripts/notifications-fixture.ts reset
 *
 * Invoked directly rather than through `npm run mig`, which forwards only its
 * first argument and would swallow the command word.
 */

import { db } from '@/config/db'
import { notifyEvent, type NotifyResult } from '@/lib/notifications/emit'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { AWAY_GAP_MINUTES } from '@/db/notifications/presence'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import type { NotificationEvent } from '@/lib/notifications/types'

/** Whose bell we are filling. Override with --email=... */
const DEFAULT_EMAIL = 'alamayo274@gmail.com'

/** How long ago the staged absence started. Must exceed AWAY_GAP_MINUTES (15). */
const AWAY_MINUTES = 60

/**
 * A conversation id that intentionally does not exist locally.
 *
 * `message.unanswered` is a conversation-entity type, and creating a real
 * `inbox_conversations` row would move `unreadCount` — which is the number the
 * NAV badge shows. The fixture must not be able to disturb that badge, because
 * "the conversation badge did not change" is one of the things being verified.
 * The tradeoff is that this row's deep link opens the inbox with no thread
 * selected; verify deep links with a lead notification instead.
 */
const SYNTHETIC_CONVERSATION_ID = 900_001

type Target = { userId: number; agencyId: number; email: string; role: string }
type Lead = { id: number; name: string }

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const line = (s = '') => console.log(s)

async function resolveTarget(): Promise<Target> {
  const email = arg('email') ?? DEFAULT_EMAIL
  const user = await db('users').where({ email }).first('id', 'agencyId', 'role', 'email', 'suspended')
  if (!user) throw new Error(`No user with email ${email}. Pass --email=<your login email>.`)
  if (user.suspended) throw new Error(`User ${email} is suspended and can never receive a notification.`)
  if (!user.agencyId) throw new Error(`User ${email} has no agencyId.`)
  return { userId: Number(user.id), agencyId: Number(user.agencyId), email: String(user.email), role: String(user.role) }
}

/**
 * Leads the target user actually handles.
 *
 * Required, not cosmetic: `handler_or_admin` resolves the recipient from
 * `clients.handlerId`, and a lead that is not in the agency resolves to NO
 * recipient at all — the worker would skip every job with `no_recipients` and the
 * fixture would silently produce nothing.
 */
async function pickLeads(target: Target, count: number): Promise<Lead[]> {
  const rows = await db('clients')
    .where({ agencyId: target.agencyId, handlerId: target.userId })
    .orderBy('id', 'desc')
    .limit(count)
    .select('id', 'name')

  if (rows.length < count) {
    throw new Error(
      `Need ${count} leads handled by user ${target.userId} in agency ${target.agencyId}, found ${rows.length}. ` +
        `Seed some leads first (npm run mig seed-test-leads.ts).`,
    )
  }
  return rows.map((r: { id: number; name: string | null }) => ({
    id: Number(r.id),
    name: (r.name ?? '').trim() || `ליד ${r.id}`,
  }))
}

/**
 * One specific lead, still scoped by agency and handler.
 *
 * The scoping is not ceremony: a lead outside the agency resolves to no recipient
 * and the job would be skipped, which looks identical to the fixture doing
 * nothing. Failing loudly here says why.
 */
async function leadById(target: Target, id: number): Promise<Lead> {
  if (!Number.isFinite(id)) throw new Error(`--lead must be a number, got "${id}".`)
  const row = await db('clients')
    .where({ id, agencyId: target.agencyId, handlerId: target.userId })
    .first('id', 'name')
  if (!row) throw new Error(`Lead ${id} is not in agency ${target.agencyId} handled by user ${target.userId}.`)
  return { id: Number(row.id), name: (row.name ?? '').trim() || `ליד ${row.id}` }
}

async function emit(label: string, event: NotificationEvent): Promise<NotifyResult> {
  const res = await notifyEvent(event)
  const detail = res.enqueued === true ? `job ${res.jobId}` : res.reason
  line(`  ${res.enqueued ? 'enqueued' : 'skipped '}  ${label.padEnd(38)} ${detail}`)
  return res
}

/**
 * Drain until nothing is left, so the fixture never waits on cron.
 *
 * This is the shipped worker, unmodified — the fixture supplies the trigger the
 * `after()` kick cannot, since there is no request scope in a script.
 */
async function drain(): Promise<void> {
  for (let pass = 1; pass <= 5; pass++) {
    const s = await runNotificationWorker({ limit: 20, workerId: `fixture-pass-${pass}` })
    if (s.claimed === 0) break
    line(`  worker: claimed=${s.claimed} done=${s.done} skipped=${s.skipped} created=${s.created} dead=${s.dead}`)
  }
}

function assertFlags(target: Target): void {
  const problems: string[] = []
  if (!isNotificationsEnabled()) problems.push('NOTIFICATIONS_ENABLED is not "1" — notifyEvent will shadow-log and enqueue nothing.')
  if (!isNotificationsAgencyAllowlisted(target.agencyId))
    problems.push(
      `agency ${target.agencyId} is not in NOTIFICATIONS_AGENCY_ALLOWLIST — set it to "all" or include ${target.agencyId}.`,
    )
  if (problems.length) throw new Error(`Flags block this fixture:\n  - ${problems.join('\n  - ')}`)
}

/**
 * SEED — seven events that produce exactly six notification rows, then a staged
 * absence.
 *
 * EACH EVENT IS DRAINED BEFORE THE NEXT IS EMITTED, which is what makes the
 * result reproducible. The worker claims with `ORDER BY "notBefore" ASC` and no id
 * tiebreak, so jobs enqueued in the same instant are claimed in an arbitrary
 * order. That is harmless in production, where these events arrive minutes apart,
 * but in a fixture that enqueues seven at once it would shuffle the dropdown
 * between runs and — for the two events that share a collapse key — decide which
 * one's copy wins. One event per pass removes both. Nothing in the engine was
 * changed to accommodate it.
 */
async function seed(target: Target): Promise<void> {
  assertFlags(target)
  const leads = await pickLeads(target, 6)
  const [a, b, c, d, e] = leads
  const now = new Date()
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000)

  line(`Target: ${target.email} (user ${target.userId}, agency ${target.agencyId}, role ${target.role})`)
  line(`Leads:  ${leads.map((l) => `${l.id}`).join(', ')}`)

  const steps: { label: string; note: string; event: NotificationEvent }[] = [
    {
      label: `lead.created (lead ${a.id})`,
      note: 'leads / medium — toasts while online',
      event: { type: 'lead.created', agencyId: target.agencyId, entityType: 'lead', entityId: a.id, actorUserId: null, occurredAt: at(50), payload: { leadName: a.name } },
    },
    {
      label: `lead.created (lead ${b.id})`,
      note: 'opens the arrival row the next event upgrades',
      event: { type: 'lead.created', agencyId: target.agencyId, entityType: 'lead', entityId: b.id, actorUserId: null, occurredAt: at(45), payload: { leadName: b.name } },
    },
    {
      // Shares `lead:{id}:arrival` with the event above, so it is ABSORBED rather
      // than added: one row, type and title replaced by the newer truth, priority
      // raised medium → high, groupCount 2. The engine's own §10.2 behaviour.
      label: `lead.hot (lead ${b.id})`,
      note: 'collapses into the row above ⇒ groupCount 2, no new row',
      event: { type: 'lead.hot', agencyId: target.agencyId, entityType: 'lead', entityId: b.id, actorUserId: null, occurredAt: at(44), payload: { leadName: b.name } },
    },
    {
      label: `followup.due (lead ${c.id})`,
      note: 'followups / medium — toasts while online',
      event: { type: 'followup.due', agencyId: target.agencyId, entityType: 'lead', entityId: c.id, actorUserId: null, occurredAt: at(30), payload: { leadName: c.name } },
    },
    {
      // High priority that deliberately does NOT toast (PUSH_WHEN_AWAY): proves the
      // policy matrix survives the trip to the browser, and that "high" is not a
      // synonym for "interrupt".
      label: `followup.overdue (lead ${d.id})`,
      note: 'followups / high but PUSH_WHEN_AWAY ⇒ never toasts while online',
      event: { type: 'followup.overdue', agencyId: target.agencyId, entityType: 'lead', entityId: d.id, actorUserId: null, occurredAt: at(25), payload: { leadName: d.name } },
    },
    {
      // The messages category WITHOUT touching message.inbound, which stays
      // unwired pending its per-message discriminator. The recipient comes from
      // payload.leadId — how every conversation-entity job resolves a lead.
      label: `message.unanswered (conv ${SYNTHETIC_CONVERSATION_ID})`,
      note: 'messages / high — silent twice over: policy, and awareness suppression',
      event: { type: 'message.unanswered', agencyId: target.agencyId, entityType: 'conversation', entityId: SYNTHETIC_CONVERSATION_ID, actorUserId: null, occurredAt: at(20), payload: { leadName: e.name, leadId: e.id } },
    },
    {
      // admin_only — reaches this user only because they are ADMIN. The one row
      // with a body, so the dropdown's two-line layout is covered too.
      label: 'integration.disconnected (facebook)',
      note: 'integrations / critical / admin_only — toasts, and has a body',
      event: { type: 'integration.disconnected', agencyId: target.agencyId, entityType: 'integration', entityId: target.agencyId, actorUserId: null, occurredAt: at(10), payload: { provider: 'facebook' } },
    },
  ]

  for (const [i, step] of steps.entries()) {
    line()
    line(`Event ${i + 1}/${steps.length} — ${step.note}`)
    await emit(step.label, step.event)
    await drain()
  }

  await stageAbsence(target)
  await status(target)
}

/**
 * Stage the absence that makes "While you were away" real.
 *
 * Sets `lastSeenAt` to AWAY_MINUTES ago and leaves `awaySinceAt` NULL — exactly
 * the row a user who walked away would have left behind. The first feed poll then
 * measures the gap itself, opens the boundary at that `lastSeenAt`
 * (`resolveAwayBoundary`), and persists it. The fixture does not pre-open the
 * boundary, so what gets verified is the product's own detection rather than a
 * value this script wrote.
 */
async function stageAbsence(target: Target): Promise<void> {
  const lastSeenAt = new Date(Date.now() - AWAY_MINUTES * 60_000)
  await db.raw(
    `INSERT INTO user_presence ("userId","agencyId","lastSeenAt","lastSeenVisible","awaySinceAt","updatedAt")
     VALUES (:userId,:agencyId,:lastSeenAt,true,NULL,now())
     ON CONFLICT ("userId") DO UPDATE
        SET "lastSeenAt" = EXCLUDED."lastSeenAt",
            "agencyId"   = EXCLUDED."agencyId",
            "lastSeenVisible" = true,
            "awaySinceAt" = NULL,
            "updatedAt"  = now()`,
    { userId: target.userId, agencyId: target.agencyId, lastSeenAt },
  )
  line()
  line(`Staged absence: lastSeenAt = ${AWAY_MINUTES}m ago, awaySinceAt = NULL (gap > ${AWAY_GAP_MINUTES}m ⇒ WYWA will open).`)
}

/**
 * LIVE — one notification emitted right now, for the toast.
 *
 * Run this with the workspace open in the browser. Presence is ONLINE by then, so
 * `lead.created` resolves a toast channel, and the row is newer than the tab's
 * mount boundary, so it is genuinely new rather than backlog.
 */
async function live(target: Target): Promise<void> {
  assertFlags(target)
  const requested = arg('lead')
  const lead = requested ? await leadById(target, Number(requested)) : (await pickLeads(target, 6))[5]
  // Default is the one lead seed() leaves alone, so this opens a new row instead
  // of collapsing into an existing arrival.

  line(`Target: ${target.email} (user ${target.userId}, agency ${target.agencyId})`)
  line()
  line('Events:')
  const res = await emit(`lead.created (lead ${lead.id})`, {
    type: 'lead.created',
    agencyId: target.agencyId,
    entityType: 'lead',
    entityId: lead.id,
    actorUserId: null,
    occurredAt: new Date(),
    payload: { leadName: lead.name },
  })

  if (res.enqueued === false && res.reason === 'duplicate') {
    line()
    line(`  Already emitted for lead ${lead.id} — eventKey is once-per-lead for lead.created.`)
    line('  Run `reset` first, or pass --lead=<other lead id> to use a different lead.')
  }

  await drain()
  await status(target)
}

async function status(target: Target): Promise<void> {
  const rows = await db('notifications')
    .where({ agencyId: target.agencyId, userId: target.userId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .select('id', 'type', 'category', 'priority', 'title', 'groupCount', 'createdAt', 'seenAt', 'readAt')

  line()
  line(`notifications (${rows.length}) for user ${target.userId}:`)
  console.table(
    rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      type: r.type,
      cat: r.category,
      pri: r.priority,
      title: String(r.title).slice(0, 30),
      grp: r.groupCount,
      seen: r.seenAt ? 'yes' : '—',
      read: r.readAt ? 'yes' : '—',
    })),
  )

  const unread = rows.filter((r: Record<string, unknown>) => r.readAt == null).length
  const unseen = rows.filter((r: Record<string, unknown>) => r.seenAt == null).length
  line(`unread (bell badge) = ${unread}    unseen (WYWA pool) = ${unseen}`)

  const jobs = await db('notification_jobs').where({ agencyId: target.agencyId }).select('status').count('id as n').groupBy('status')
  line(`jobs: ${jobs.map((j: { status: string; n: string }) => `${j.status}=${j.n}`).join(' ') || 'none'}`)

  const presence = await db('user_presence')
    .where({ userId: target.userId, agencyId: target.agencyId })
    .first('lastSeenAt', 'lastSeenVisible', 'awaySinceAt')
  line(
    presence
      ? `presence: lastSeenAt=${new Date(presence.lastSeenAt).toISOString()} visible=${presence.lastSeenVisible} awaySinceAt=${
          presence.awaySinceAt ? new Date(presence.awaySinceAt).toISOString() : 'null'
        }`
      : 'presence: no row (⇒ OFFLINE)',
  )
}

/**
 * RESET — remove everything the notification system created for this user.
 *
 * Deliberately broad within the notification tables rather than clever: no
 * production emitter is wired yet, so locally there is no other source of these
 * rows, and "delete the notification state" is easier to trust than a manifest
 * that could drift. It never touches leads, conversations or users.
 */
async function reset(target: Target): Promise<void> {
  const deliveries = await db('notification_deliveries').where({ agencyId: target.agencyId, userId: target.userId }).del()
  const notifications = await db('notifications').where({ agencyId: target.agencyId, userId: target.userId }).del()
  const jobs = await db('notification_jobs').where({ agencyId: target.agencyId }).del()
  const presence = await db('user_presence').where({ userId: target.userId, agencyId: target.agencyId }).del()

  line(`Deleted: deliveries=${deliveries} notifications=${notifications} jobs=${jobs} presence=${presence}`)
  line('Leads, conversations and users were not touched.')
}

function help(): void {
  line('Local notification fixture — development only.')
  line()
  line('  npx tsx scripts/notifications-fixture.ts seed     six rows + a staged 60m absence')
  line('  npx tsx scripts/notifications-fixture.ts live     one notification NOW, for the toast')
  line('  npx tsx scripts/notifications-fixture.ts status   current rows, counts and presence')
  line('  npx tsx scripts/notifications-fixture.ts reset    delete all notification state for the user')
  line()
  line(`  --email=<login email>   whose bell to fill (default ${DEFAULT_EMAIL})`)
  line('  --lead=<lead id>        which lead `live` emits about, to toast more than once')
}

async function run(): Promise<void> {
  const command = process.argv.find((a) => ['seed', 'live', 'status', 'reset', 'help'].includes(a)) ?? 'help'
  if (command === 'help') return help()

  const target = await resolveTarget()
  if (command === 'seed') return seed(target)
  if (command === 'live') return live(target)
  if (command === 'status') return status(target)
  if (command === 'reset') return reset(target)
}

run()
  .then(() => db.destroy())
  .catch(async (e) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`)
    await db.destroy()
    process.exit(1)
  })
