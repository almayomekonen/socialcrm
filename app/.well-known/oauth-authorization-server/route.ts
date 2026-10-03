import type { NextResponse } from 'next/server'
import { authorizationServerMetadata, discoveryResponse } from '@/lib/oauth/server/metadata'

/** RFC 8414 authorization server metadata. 404 while MCP is disabled. */
export async function GET(): Promise<NextResponse> {
  return discoveryResponse(authorizationServerMetadata)
}
