import 'server-only'
import { db } from '@/config/db'
import { listTemplates } from '@/db/whatsappTemplates'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import {
  resolveWhatsappHealth,
  type WaConnectionRow,
  type WhatsappHealthPrimary,
} from '@/lib/whatsapp/operationalStatus'
import { isAdmin, type Roles } from '@/types/roles'
import type { Template } from '@/lib/whatsapp/templates/types'

/**
 * Server facts the conversation composer needs: THIS conversation's phone
 * (never agency `.first()`), Connection Health for that phone, and approved
 * templates when the feature flag is on.
 */

export type ConversationSendScope = {
  conversationId: number
  leadId: number | null
  businessPhoneNumberId: string
  /**
   * The CUSTOMER's WhatsApp number (E.164 digits), as stored on the
   * conversation. Carried so the composer can offer a native WhatsApp fallback
   * in the states where Meta's rules leave no in-app way to write. Optional:
   * older callers and test doubles that do not supply it simply get no
   * fallback, never a malformed link.
   */
  customerWaId?: string | null
}

export type WhatsappComposerContext = {
  health: WhatsappHealthPrimary
  templatesEnabled: boolean
  templates: Template[]
  canManageTemplates: boolean
  /** Customer number for the composer's native-WhatsApp fallback. */
  customerWaId?: string | null
  businessPhoneNumberId: string | null
}

export type ComposerContextDeps = {
  getConversation: (agencyId: number, conversationId: number) => Promise<ConversationSendScope | null>
  getLatestConversationForLead: (agencyId: number, leadId: number) => Promise<ConversationSendScope | null>
  getLatestInboundAt: (agencyId: number, conversationId: number) => Promise<string | null>
  getConnectionForPhone: (agencyId: number, phoneNumberId: string) => Promise<WaConnectionRow | null>
  resolveHealth: (conn: WaConnectionRow | null, agencyId: number) => Promise<{ primary: WhatsappHealthPrimary }>
  isTemplatesEnabled: (agencyId: number) => boolean
  listApprovedTemplates: (agencyId: number) => Promise<Template[]>
}

export async function queryConversationSendScope(
  agencyId: number,
  conversationId: number,
): Promise<ConversationSendScope | null> {
  const row = await db('inbox_conversations')
    .where({ id: conversationId, agencyId })
    .first('id', 'leadId', 'businessPhoneNumberId', 'customerWaId')
  if (!row) return null
  const phone = String(row.businessPhoneNumberId ?? '').trim()
  if (!phone) return null
  return {
    conversationId: Number(row.id),
    leadId: row.leadId != null ? Number(row.leadId) : null,
    businessPhoneNumberId: phone,
    customerWaId: row.customerWaId != null ? String(row.customerWaId) : null,
  }
}

export async function queryLatestConversationForLead(
  agencyId: number,
  leadId: number,
): Promise<ConversationSendScope | null> {
  const row = await db('inbox_conversations')
    .where({ leadId, agencyId, channel: 'whatsapp' })
    .orderByRaw('"lastMessageAt" DESC NULLS LAST')
    .orderBy('id', 'desc')
    .first('id', 'leadId', 'businessPhoneNumberId')
  if (!row) return null
  const phone = String(row.businessPhoneNumberId ?? '').trim()
  if (!phone) return null
  return {
    conversationId: Number(row.id),
    leadId: row.leadId != null ? Number(row.leadId) : null,
    businessPhoneNumberId: phone,
  }
}

export async function queryLatestInboundAt(agencyId: number, conversationId: number): Promise<string | null> {
  const row = await db('inbox_messages')
    .where({ conversationId, agencyId, direction: 'inbound', channel: 'whatsapp' })
    .orderByRaw('COALESCE("channelTimestamp", "createdAt") DESC')
    .first('channelTimestamp', 'createdAt')
  if (!row) return null
  const ts = row.channelTimestamp ?? row.createdAt
  if (!ts) return null
  return ts instanceof Date ? ts.toISOString() : String(ts)
}

export async function queryConnectionForPhone(
  agencyId: number,
  phoneNumberId: string,
): Promise<WaConnectionRow | null> {
  const row = await db('whatsapp_connections')
    .where({ phone_number_id: phoneNumberId, agency_id: agencyId })
    .first('phone_number_id', 'access_token', 'waba_id')
  if (!row) return null
  return {
    phone_number_id: String(row.phone_number_id),
    access_token: String(row.access_token),
    waba_id: (row.waba_id as string | null) ?? null,
  }
}

const defaultDeps: ComposerContextDeps = {
  getConversation: queryConversationSendScope,
  getLatestConversationForLead: queryLatestConversationForLead,
  getLatestInboundAt: queryLatestInboundAt,
  getConnectionForPhone: queryConnectionForPhone,
  resolveHealth: async (conn, agencyId) => resolveWhatsappHealth(conn, agencyId),
  isTemplatesEnabled: isTemplatesEnabledForAgency,
  listApprovedTemplates: async (agencyId) =>
    (await listTemplates(agencyId)).filter((t) => t.status === 'approved'),
}

export async function loadWhatsappComposerContext(
  agencyId: number,
  conversationId: number,
  opts?: { role?: Roles | string | null; deps?: Partial<ComposerContextDeps> },
): Promise<WhatsappComposerContext> {
  const deps = { ...defaultDeps, ...opts?.deps }
  const empty: WhatsappComposerContext = {
    health: 'disconnected',
    templatesEnabled: false,
    templates: [],
    canManageTemplates: isAdmin(opts?.role as Roles),
    businessPhoneNumberId: null,
    customerWaId: null,
  }

  const scope = await deps.getConversation(agencyId, conversationId)
  if (!scope) return empty

  const conn = await deps.getConnectionForPhone(agencyId, scope.businessPhoneNumberId)
  const health = (await deps.resolveHealth(conn, agencyId)).primary
  const templatesEnabled = deps.isTemplatesEnabled(agencyId)
  const templates = templatesEnabled ? await deps.listApprovedTemplates(agencyId) : []

  return {
    health,
    templatesEnabled,
    templates,
    canManageTemplates: isAdmin(opts?.role as Roles),
    businessPhoneNumberId: scope.businessPhoneNumberId,
    customerWaId: scope.customerWaId ?? null,
  }
}
