import { LandingPage, landingMetadata } from '@/components/seo/LandingPage'
import { WHATSAPP_PAGE } from '@/lib/marketing/landing/whatsapp'

/**
 * `/crm-for-whatsapp-business` — "CRM לוואטסאפ". Rewritten on the shared landing
 * template; the URL is unchanged. What the page may and may not promise is
 * documented on `WHATSAPP_PAGE`.
 */
export const metadata = landingMetadata(WHATSAPP_PAGE)

export default function CrmForWhatsappBusinessPage() {
  return <LandingPage page={WHATSAPP_PAGE} />
}
