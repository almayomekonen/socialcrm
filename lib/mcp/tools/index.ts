import type { McpToolDef } from '../server'
import { searchLeads } from './searchLeads'
import { getLead } from './getLead'
import { getLeadsNeedingFollowup } from './getLeadsNeedingFollowup'
import { getTodayBrief } from './getTodayBrief'

/** The MCP tool registry. Read-only lead tools (Task 13); conversation tools follow in Task 14. */
export const MCP_TOOLS: McpToolDef[] = [searchLeads, getLead, getLeadsNeedingFollowup, getTodayBrief]
