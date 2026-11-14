import { LandingPage, landingMetadata } from '@/components/lumen/landing/LandingPage'
import { CRM_PAGE } from '@/lib/marketing/landing/crm'

/** `/crm` — "מערכת CRM". Was a 308 to \`/\`; \`/crm-vs-excel\` now redirects here. */
export const metadata = landingMetadata(CRM_PAGE)

export default function Page() {
  return <LandingPage page={CRM_PAGE} />
}
