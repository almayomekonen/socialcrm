import type { ModelMessage } from 'ai'
import type { RunStructuredImageAttachment } from '../router'

export function buildPrompt(
  user: string,
  images: RunStructuredImageAttachment[] | undefined,
): { prompt: string } | { messages: ModelMessage[] } {
  const validImages = (images ?? []).filter((image) => isHttpUrl(image.url))
  if (validImages.length === 0) return { prompt: user }

  const content: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: user },
        ...validImages.map((image) => ({
          type: 'image' as const,
          image: new URL(image.url),
          mediaType: image.mediaType,
        })),
      ],
    },
  ]

  return { messages: content }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
