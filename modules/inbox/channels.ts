import type { InboxChannel } from './types'

/**
 * Channel registry. Adding a channel = one entry here + an ingest/transport
 * adapter + a webhook route. The Inbox UI reads labels from here, so new
 * channels surface in the list with zero UI changes.
 */
export const CHANNEL_LABEL: Record<InboxChannel, string> = {
  whatsapp: 'WhatsApp',
}

export function channelLabel(channel: string): string {
  return (CHANNEL_LABEL as Record<string, string>)[channel] ?? channel
}

/** Channels whose conversation workspace is implemented today. */
export const SUPPORTED_WORKSPACE_CHANNELS: ReadonlySet<string> = new Set<InboxChannel>(['whatsapp'])
