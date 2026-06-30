import { headers } from 'next/headers'
import { userAgent } from 'next/server'

/**
 * Server-side mobile (phone) detection from the request User-Agent.
 *
 * The CRM is a desktop-only product. This is the single source of truth for
 * "is this a phone", used by:
 *   - the (app) layout — redirect authenticated mobile users to /activate so
 *     they never reach the dashboard, and
 *   - the /activate route — so an onboarded mobile user is NOT bounced back to
 *     the dashboard (which would loop), keeping /activate as the one mobile
 *     experience.
 *
 * `device.type` is 'mobile' for phones (undefined for desktop, 'tablet' for
 * tablets). We gate on phones only; large/landscape tablets keep the desktop
 * experience, matching the historical >=1000px behaviour as closely as a
 * UA-based server redirect can.
 */
export async function isMobileRequest(): Promise<boolean> {
  const { device } = userAgent({ headers: await headers() })
  return device.type === 'mobile'
}
