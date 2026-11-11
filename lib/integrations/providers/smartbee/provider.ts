import 'server-only'
import { isSmartbeeAgency, smartbeeProductionEnabled } from '@/lib/flags/smartbeeFlags'
import { loadSmartbeeConnection } from '@/db/smartbee/connections'
import type { ProviderDefinition } from '@/lib/integrations/core/types'

/** SmartBee, the first Integration Core provider: issues legal documents for a named agency. */
export const smartbeeProvider: ProviderDefinition = {
  id: 'smartbee',
  label: 'SmartBee',
  capabilities: ['issue_documents'],
  documentKinds: ['invoice', 'receipt', 'invoice_receipt'],
  isAgencyAllowed: isSmartbeeAgency,
  productionEnabled: smartbeeProductionEnabled,
  loadConnection: loadSmartbeeConnection,
}
