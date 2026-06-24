/**
 * AI Lead Qualifier — global kill switch (env backstop).
 *
 * Instant, per-agency kill levers are the DB flags (no redeploy): set
 * auto_response_settings.mode='acknowledge', or draft=true, or enabled=false, or
 * agencies.autoResponseEnabled=false. This env flag is the GLOBAL backstop —
 * INBOX_QUALIFIER_KILL=1 halts qualify processing for every agency at once (takes
 * effect on the next deploy, since env is read at runtime).
 */
export function isQualifierEnabled(): boolean {
  const v = process.env.INBOX_QUALIFIER_KILL
  return !(v === '1' || v === 'true')
}
