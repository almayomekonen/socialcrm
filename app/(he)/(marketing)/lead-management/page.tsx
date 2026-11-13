import { LandingPage, landingMetadata } from '@/components/seo/LandingPage'
import { LEAD_MANAGEMENT_PAGE } from '@/lib/marketing/landing/leadManagement'

/** `/lead-management` — "מערכת לניהול לידים". */
export const metadata = landingMetadata(LEAD_MANAGEMENT_PAGE)

export default function LeadManagementPage() {
  return <LandingPage page={LEAD_MANAGEMENT_PAGE} />
}
