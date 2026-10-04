import { z } from 'zod'
import type { McpToolDef } from '../server'
import { buildTodayBrief } from '@/lib/today/service'
import { leadRef, leadRefShape, untrustedText } from '../present'

export const getTodayBriefInput = z.object({}).strict()

/** Today is finite, but an assistant reply should be bounded; `total` stays true. */
const MAX_ITEMS = 50

export const getTodayBriefOutput = z.object({
  total: z.number().int(),
  remaining: z.number().int(),
  handledToday: z.number().int(),
  done: z.boolean(),
  permissionVerdict: z.enum(['scoped_all_clear', 'scoped_partial']),
  truncated: z.boolean(),
  items: z.array(
    z.object({
      ...leadRefShape,
      state: z.string(),
      reason: z.string(),
      conversationId: z.number().int().nullable(),
      waitingFor: z.string().nullable(),
    }),
  ),
})

export const getTodayBrief: McpToolDef = {
  name: 'get_today_brief',
  title: "Today's brief",
  description:
    "The user's Today list from SocialCRM: the leads that need action today and why (waiting for a WhatsApp reply, " +
    "follow-up overdue or due today, new inbound lead, overdue task, open loop), in SocialCRM's priority order. Use for " +
    "'what should I do today?' or 'what needs my attention?'. `reason` is a Hebrew label; keep it or translate it. " +
    "`permissionVerdict: 'scoped_partial'` means the user sees only part of the team's work.",
  scope: 'crm.leads.read',
  inputSchema: getTodayBriefInput,
  outputSchema: getTodayBriefOutput,
  run: async (p) => {
    // The same buildTodayBrief the web app and the mobile API call, with the
    // scope passed down from the principal (sessionless, permission-scoped).
    const brief = await buildTodayBrief(
      {
        scope: { user: { role: p.role }, gotPermIds: p.gotPermIds },
        agencyId: p.agencyId,
        userId: p.userId,
        firstName: p.firstName,
      },
      Date.now(),
    )
    // Projected field by field: phone, href, windowHint, targetSurface,
    // greeting and meetings are deliberately not forwarded.
    const items = brief.items.slice(0, MAX_ITEMS).map((i) => ({
      ...leadRef(Number(i.id), untrustedText(i.name, 120)),
      state: i.state,
      reason: i.reason,
      conversationId: typeof i.conversationId === 'number' ? i.conversationId : null,
      waitingFor: i.waitingFor ?? null,
    }))
    return {
      data: {
        total: brief.total,
        remaining: brief.remaining,
        handledToday: brief.handledToday,
        done: brief.done,
        permissionVerdict: brief.permissionVerdict,
        truncated: brief.items.length > items.length,
        items,
      },
      resultCount: items.length,
    }
  },
}
