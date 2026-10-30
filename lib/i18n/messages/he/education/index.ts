/**
 * Education namespace (Phase E6) — the product tours and their chrome. Hebrew
 * copied verbatim. Copilot's own pieces (the "Show me" button inside an
 * answer, the guide offers it answers with) are AI surface and stay Hebrew.
 */
import { tours } from './tours'
import { chrome, intro, help, leadsEmpty } from './chrome'

export const education = { tours, chrome, intro, help, leadsEmpty } as const
