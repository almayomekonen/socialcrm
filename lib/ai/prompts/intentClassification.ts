import { z } from 'zod'

export const IntentClassificationSchema = z.object({
  intent: z.enum([
    'social.gratitude',
    'social.greeting',
    'social.positive',
    'social.farewell',
    'task',
    'crm',
    'search',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
})

export type IntentClassification = z.infer<typeof IntentClassificationSchema>

export const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `Classify the user message into ONE intent. Return JSON only.

Intents:
- social.gratitude: thanks, appreciation
- social.greeting: hello, good morning, hi
- social.positive: cool, nice, perfect, lol, emoji-only reaction
- social.farewell: bye, goodnight, see you
- task: user asks you to write/send/draft/create something
- crm: question about lead, business analysis, status
- search: user wants to find files
- unknown: anything else

Set confidence > 0.9 only when classification is obvious.

Examples:
"תודה רבה" → {"intent":"social.gratitude","confidence":0.99}
"חחח אחי תודההה ❤️" → {"intent":"social.gratitude","confidence":0.97}
"בוקר טוב" → {"intent":"social.greeting","confidence":0.99}
"מה אני יכול למכור לליד?" → {"intent":"crm","confidence":0.95}
"תכתוב הודעת תודה לליד" → {"intent":"task","confidence":0.96}
"תמצא חוזה" → {"intent":"search","confidence":0.95}`
