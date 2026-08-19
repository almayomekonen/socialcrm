import LeadsFirstRunMobile from '@/modules/leads/mobile/LeadsFirstRunMobile'

/**
 * Workspace has no leads. Same first-run as empty `/leads` — add, import, or
 * connect channels on the phone. Not a desktop handoff.
 */
export default function MobileTodayEmpty({
  metaConnected = false,
  whatsappConnected = false,
}: {
  metaConnected?: boolean
  whatsappConnected?: boolean
}) {
  return <LeadsFirstRunMobile metaConnected={metaConnected} whatsappConnected={whatsappConnected} />
}
