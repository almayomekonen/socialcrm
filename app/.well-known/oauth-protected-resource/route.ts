import type { NextResponse } from 'next/server'
import { discoveryResponse, protectedResourceMetadata } from '@/lib/oauth/server/metadata'

/**
 * RFC 9728 root form — the fallback MCP clients try when no path-specific
 * document is found. Same document as the path form. 404 while MCP is disabled.
 */
export async function GET(): Promise<NextResponse> {
  return discoveryResponse(protectedResourceMetadata)
}
