import type { WhenAsk } from './tasks/draft'

/**
 * The one short question about WHEN, shared by meetings, tasks and follow-ups.
 * Pure. Never a list of examples, never a word about how it works.
 */
export function whenQuestion(ask: WhenAsk, detail: { hour: number | null; time: string | null }): string {
  switch (ask) {
    case 'ambiguous_date':
      return 'לאיזה יום בדיוק?'
    case 'past_date':
      return 'התאריך הזה כבר עבר. לאיזה יום?'
    case 'ambiguous_time':
      return detail.hour === null ? 'באיזו שעה?' : `ב-${detail.hour} בבוקר או אחר הצהריים?`
    case 'ask_time':
      return 'באיזו שעה?'
    case 'past_today':
      return `השעה ${detail.time} היום כבר עברה. למחר באותה שעה?`
  }
}
