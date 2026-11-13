import { LandingPage, landingMetadata } from '@/components/seo/LandingPage'
import { CRM_PAGE } from '@/lib/marketing/landing/crm'

/** `/crm` — the "מערכת CRM" guide. Was a 308 to `/` until this page existed. */
export const metadata = landingMetadata(CRM_PAGE)

export default function CrmGuidePage() {
  return <LandingPage page={CRM_PAGE} />
}
