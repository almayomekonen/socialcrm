import { LandingPage, landingMetadata } from '@/components/lumen/landing/LandingPage'
import { FACEBOOK_LEADS_PAGE } from '@/lib/marketing/landing/facebookLeads'

/** `/facebook-leads` — "חיבור לידים מפייסבוק ל-CRM". Was a 308 to \`/channels\`. */
export const metadata = landingMetadata(FACEBOOK_LEADS_PAGE)

export default function Page() {
  return <LandingPage page={FACEBOOK_LEADS_PAGE} />
}
