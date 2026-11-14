import { LandingPage, landingMetadata } from '@/components/lumen/landing/LandingPage'
import { INSTAGRAM_LEADS_PAGE } from '@/lib/marketing/landing/instagramLeads'

/** `/instagram-leads` — "לידים מאינסטגרם ל-CRM". \`/instagram-leads-crm\` redirects here. */
export const metadata = landingMetadata(INSTAGRAM_LEADS_PAGE)

export default function Page() {
  return <LandingPage page={INSTAGRAM_LEADS_PAGE} />
}
