interface JsonLdProps {
  data: Record<string, unknown>
}

/**
 * Renders a JSON-LD <script> tag for structured data. Server component.
 * Use to emit schema.org structured data without inlining
 * dangerouslySetInnerHTML at every callsite.
 */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
