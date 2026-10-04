import type { McpToolDef } from '../server'
import { searchLeads } from './searchLeads'
import { getLead } from './getLead'
import { getLeadsNeedingFollowup } from './getLeadsNeedingFollowup'
import { getTodayBrief } from './getTodayBrief'
import { getLeadConversations } from './getLeadConversations'
import { getConversation } from './getConversation'
import { getUnansweredConversations } from './getUnansweredConversations'

/** The MCP tool registry: read-only lead tools (Task 13) and WhatsApp conversation tools (Task 14). */
export const MCP_TOOLS: McpToolDef[] = [
  searchLeads,
  getLead,
  getLeadsNeedingFollowup,
  getTodayBrief,
  getLeadConversations,
  getConversation,
  getUnansweredConversations,
]
