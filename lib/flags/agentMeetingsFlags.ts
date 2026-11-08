/**
 * AGENT_LIST_MEETINGS_AGENCY_IDS: agencies whose Agent may answer meeting
 * questions with the `list_meetings` tool, on every surface the Agent runs on
 * (web Agent and the WhatsApp owner assistant).
 *
 * Same rules as the WhatsApp status / notes switches: ABSENCE BLOCKS (unset or
 * empty means no agency), explicit numeric ids only. AGENT_LIST_MEETINGS_AUDIENCE=all
 * offers it to every agency the Agent runs for. Read per call, never cached.
 *
 * WHERE IT IS CHECKED, all server-side, all from the authenticated scope:
 *   · lib/agent/tools/index.ts: the tool is registered only when on, so a
 *     disabled agency's model is never offered it and the SDK has nothing to run;
 *   · lib/agent/run.ts: the prompt's meetings rule is added only when on;
 *   · lib/agent/tools/listMeetings.ts: the tool refuses before any read if it
 *     is ever built for a disabled agency.
 */
function parseIds(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
}

export function isAgentListMeetingsAgency(agencyId: number | null | undefined): boolean {
  if (!Number.isSafeInteger(agencyId) || (agencyId as number) <= 0) return false
  if (process.env.AGENT_LIST_MEETINGS_AUDIENCE?.trim() === 'all') return true
  return parseIds(process.env.AGENT_LIST_MEETINGS_AGENCY_IDS).includes(agencyId as number)
}
