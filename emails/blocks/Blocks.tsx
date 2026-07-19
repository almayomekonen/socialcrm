import { Hr, Section, Text } from '@react-email/components'
import type { ContentBlock } from '@/lib/emailAutomations/content/types'

// Shared block styling — the same palette + spacing as LifecycleEmail so every
// content email reads as one product. Blocks render the content section only;
// the shell (header, card, footer, unsubscribe) lives in ContentEmail.

const paragraph = {
  margin: '18px 0 0 0',
  textAlign: 'right' as const,
  fontSize: '16px',
  lineHeight: 1.8,
  color: '#3f3f46',
}

function Paragraph({ text }: { text: string }) {
  return (
    <Text dir='rtl' style={paragraph}>
      {text}
    </Text>
  )
}

function Tip({ label, text }: { label?: string; text: string }) {
  return (
    <Section
      style={{
        margin: '20px 0 0 0',
        padding: '16px 18px',
        backgroundColor: '#f5f3ff',
        border: '1px solid #e0dbff',
        borderRadius: '12px',
      }}
    >
      <Text dir='rtl' style={{ margin: 0, textAlign: 'right', fontSize: '13px', fontWeight: 700, color: '#6d28d9' }}>
        {label ?? 'טיפ'}
      </Text>
      <Text dir='rtl' style={{ margin: '6px 0 0 0', textAlign: 'right', fontSize: '15px', lineHeight: 1.7, color: '#3f3f46' }}>
        {text}
      </Text>
    </Section>
  )
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <Section style={{ margin: '20px 0 0 0' }}>
      <Text dir='rtl' style={{ margin: 0, textAlign: 'right', fontSize: '17px', fontWeight: 700, color: '#18181b' }}>
        {title}
      </Text>
      <Text dir='rtl' style={{ ...paragraph, margin: '6px 0 0 0' }}>{text}</Text>
    </Section>
  )
}

function Testimonial({ quote, source }: { quote: string; source?: string }) {
  return (
    <Section
      style={{
        margin: '22px 0 0 0',
        padding: '20px 22px',
        backgroundColor: '#fafafa',
        borderRight: '3px solid #4f46e5',
        borderRadius: '12px',
      }}
    >
      <Text dir='rtl' style={{ margin: 0, textAlign: 'right', fontSize: '18px', lineHeight: 1.7, fontWeight: 600, color: '#27272a' }}>
        {`“${quote}”`}
      </Text>
      {source && (
        <Text dir='rtl' style={{ margin: '10px 0 0 0', textAlign: 'right', fontSize: '13px', color: '#a1a1aa' }}>
          {`— ${source}`}
        </Text>
      )}
    </Section>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <Section style={{ margin: '18px 0 0 0' }}>
      {items.map((item, idx) => (
        <Text
          key={item}
          dir='rtl'
          style={{ margin: '0 0 8px 0', textAlign: 'right', fontSize: '15px', lineHeight: 1.7, color: '#3f3f46' }}
        >
          <span style={{ color: '#4f46e5', fontWeight: 700, marginLeft: '8px' }}>{idx + 1}.</span>
          {item}
        </Text>
      ))}
    </Section>
  )
}

function Quote({ text }: { text: string }) {
  return (
    <Text dir='rtl' style={{ margin: '20px 0 0 0', textAlign: 'right', fontSize: '19px', lineHeight: 1.7, fontWeight: 600, color: '#27272a' }}>
      {`“${text}”`}
    </Text>
  )
}

function Divider() {
  return <Hr style={{ margin: '24px 0 0 0', border: 'none', borderTop: '1px solid #f2f2f4' }} />
}

// Render a single content block. Exhaustive over ContentBlock['type'].
export function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <Paragraph text={block.text} />
    case 'tip':
      return <Tip label={block.label} text={block.text} />
    case 'feature':
      return <Feature title={block.title} text={block.text} />
    case 'testimonial':
      return <Testimonial quote={block.quote} source={block.source} />
    case 'steps':
      return <Steps items={block.items} />
    case 'quote':
      return <Quote text={block.text} />
    case 'divider':
      return <Divider />
    default:
      return null
  }
}
