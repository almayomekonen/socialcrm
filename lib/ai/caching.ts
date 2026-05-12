export function anthropicCachedSystem(content: string) {
  return {
    role: 'system' as const,
    content,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  }
}
