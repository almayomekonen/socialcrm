import AccordionItem from '@/lib/AccordionItem'

export type FAQItem = {
  question: string
  answer: string
}

/** Renders the FAQ block with accordion (click to expand). Inject JSON-LD separately via buildFAQSchema. */
export function FAQSection({ title = 'שאלות נפוצות', items }: { title?: string; items: FAQItem[] }) {
  return (
    <section className='py-16 px-8' aria-labelledby='faq-heading'>
      <div className='max-w-2xl mx-auto'>
        <h2 id='faq-heading' className='text-2xl font-bold text-center mb-8'>
          {title}
        </h2>
        <div className='bg-white rounded-lg shadow-sm overflow-hidden'>
          {items.map((item) => (
            <AccordionItem
              key={item.question}
              title={item.question}
              className='flex items-center justify-between px-5 py-4 cursor-pointer select-none'
              bodyClass='px-5 pb-4 text-gray-500 text-sm leading-relaxed'
            >
              {item.answer}
            </AccordionItem>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Builds a schema.org FAQPage JSON-LD object — pass the result to a <script> tag. */
export function buildFAQSchema(items: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
