// Real customer quotes, extracted verbatim from genuine messages
// (public/media/automation-feedback-images/). Names and profile photos in the
// source screenshots are intentionally NOT used — the source label is a
// universal, timeless "לקוח/ה של SocialCRM" with no channel. Never paraphrase
// or invent; only real quotes belong here (care-charter Law 1).

export const TESTIMONIAL_SOURCE = 'לקוח/ה של SocialCRM'

export type Testimonial = { key: string; quote: string; source: string }

export const TESTIMONIALS: Record<string, Testimonial> = {
  amazing_system: { key: 'amazing_system', quote: 'מערכת מדהימה!', source: TESTIMONIAL_SOURCE },
  all_in_one: { key: 'all_in_one', quote: 'סוף סוף יש מה שמאגד את הכל', source: TESTIMONIAL_SOURCE },
  genius: { key: 'genius', quote: 'זה גאוני!', source: TESTIMONIAL_SOURCE },
}
