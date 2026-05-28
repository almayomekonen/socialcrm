// Build the conferenceData payload for Google Meet room creation.
//
// Pure, no I/O — kept separate from calendarClient.ts so:
//   1. The transport layer stays focused on HTTP.
//   2. Future Teams/Zoom conferencing plugs in alongside, not inside.
//   3. The deterministic-requestId rule has one place to live.

export type MeetConferenceData = {
  createRequest: {
    requestId: string
    conferenceSolutionKey: { type: 'hangoutsMeet' }
  }
}

// Subset of Google Calendar v3 conferenceData we care about.
export type GoogleEventConferenceData = {
  createRequest?: {
    requestId?: string
    status?: { statusCode?: 'pending' | 'success' | 'failure' }
  }
  entryPoints?: Array<{
    entryPointType?: 'video' | 'phone' | 'sip' | 'more'
    uri?: string
    label?: string
  }>
}

/**
 * Deterministic conferenceData payload. The requestId is derived from the
 * CRM meeting id so retrying the same insert never creates a second Meet
 * room. Google's contract: within the same calendar, the same requestId
 * resolves to the same conference within a short window.
 *
 * IMPORTANT: callers must also append `conferenceDataVersion=1` to the
 * events.insert query string. Without it Google silently drops the
 * createRequest and the event is created without a Meet link.
 */
export function buildMeetConferenceData(meetingId: number): MeetConferenceData {
  return {
    createRequest: {
      requestId: `crm-${meetingId}`,
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    },
  }
}

/**
 * Pull the Meet URL out of a Calendar event response. Returns null when:
 *   - Meet generation failed (Workspace admin disabled, quota, etc.)
 *   - The event was created without conferenceData (requestMeet=false)
 *   - The video entry point is unexpectedly absent
 *
 * The event itself still exists in those cases — a missing Meet URL is
 * not an event-creation failure. The caller decides whether to surface
 * it (e.g. "Meeting created, but Meet link unavailable").
 */
export function extractMeetUrl(
  conferenceData: GoogleEventConferenceData | undefined,
): string | null {
  if (!conferenceData) return null
  if (conferenceData.createRequest?.status?.statusCode === 'failure') return null
  const video = conferenceData.entryPoints?.find((e) => e.entryPointType === 'video')
  return video?.uri ?? null
}
