import { LandingPage, landingMetadata } from '@/components/lumen/landing/LandingPage'
import { WHATSAPP_PAGE } from '@/lib/marketing/landing/whatsapp'

/** `/whatsapp-crm` — "CRM לוואטסאפ". \`/crm-for-whatsapp-business\` redirects here. */
export const metadata = landingMetadata(WHATSAPP_PAGE)

export default function Page() {
  return <LandingPage page={WHATSAPP_PAGE} />
}
