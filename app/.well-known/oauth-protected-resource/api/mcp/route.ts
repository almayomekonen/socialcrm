import type { NextResponse } from 'next/server'
import { discoveryResponse, protectedResourceMetadata } from '@/lib/oauth/server/metadata'

/**
 * RFC 9728 protected resource metadata for the MCP endpoint (path-inserted
 * form, the one named in our WWW-Authenticate challenges). 404 while MCP is
 * disabled.
 */
export async function GET(): Promise<NextResponse> {
  return discoveryResponse(protectedResourceMetadata)
}
