import type { McpToolDef } from '../server'

/**
 * The MCP tool registry. Empty until the read tools land (Tasks 13–14); the
 * endpoint, auth and registry wiring are exercised by tests with a test-only
 * tool, and the Developer Mode checkpoint uses an uncommitted one.
 */
export const MCP_TOOLS: McpToolDef[] = []
