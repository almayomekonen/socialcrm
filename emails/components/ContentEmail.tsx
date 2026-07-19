import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from '@react-email/components'
import { Block } from '@/emails/blocks/Blocks'
import type { ContentItem } from '@/lib/emailAutomations/content/types'
import type { Recipient } from '@/lib/emailAutomations/types'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/**
 * The single renderer every content-driven email flows through. Same premium
 * shell as LifecycleEmail (indigo header, rounded white card, light footer +
 * optional unsubscribe), but the content section is built from the item's
 * reusable blocks. Adding an email never touches this file — only content data.
 */
export type ContentEmailProps = {
  item: ContentItem
  recipient: Recipient
  ctaUrl: string
  unsubscribeUrl?: string
}

export function ContentEmail({ item, recipient, ctaUrl, unsubscribeUrl }: ContentEmailProps) {
  const name = item.greet ? recipient.firstName?.trim() : undefined

  return (
    <Html lang='he' dir='rtl'>
      <Head />
      <Preview>{item.preview}</Preview>

      <Body style={{ backgroundColor: '#f4f4f5', margin: 0, padding: '40px 16px', fontFamily: FONT }}>
        <Container
          style={{
            margin: '0 auto',
            maxWidth: '540px',
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #ececef',
            boxShadow: '0 6px 28px rgba(15, 23, 42, 0.05)',
            overflow: 'hidden',
          }}
        >
          {/* Header — elegant wordmark */}
          <Section style={{ backgroundColor: '#4f46e5', padding: '22px 40px', textAlign: 'center' }}>
            <Text style={{ margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '0.4px', color: '#ffffff' }}>SocialCRM</Text>
          </Section>

          {/* Content */}
          <Section style={{ padding: '44px 40px 8px 40px' }}>
            {name && (
              <Text dir='rtl' style={{ margin: '0 0 8px 0', textAlign: 'right', fontSize: '14px', color: '#71717a' }}>
                היי <bdi>{name}</bdi>,
              </Text>
            )}

            <Heading
              dir='rtl'
              style={{ margin: 0, textAlign: 'right', fontSize: '25px', lineHeight: 1.35, fontWeight: 700, letterSpacing: '-0.2px', color: '#18181b' }}
            >
              {item.headline}
            </Heading>

            {item.blocks.map((block, idx) => (
              <Block key={idx} block={block} />
            ))}
          </Section>

          {/* CTA */}
          <Section style={{ padding: '20px 40px 44px 40px', textAlign: 'right' }}>
            <Button
              href={ctaUrl}
              style={{
                display: 'inline-block',
                backgroundColor: '#4f46e5',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                textDecoration: 'none',
                padding: '15px 42px',
                borderRadius: '12px',
              }}
            >
              {item.cta.label}
            </Button>
          </Section>

          {/* Footer */}
          <Section style={{ padding: '22px 40px 26px 40px', borderTop: '1px solid #f2f2f4', backgroundColor: '#fafafa', textAlign: 'center' }}>
            <Text dir='rtl' style={{ margin: 0, fontSize: '12px', lineHeight: 1.6, color: '#a1a1aa' }}>
              SocialCRM · כל הלידים שלך במקום אחד
            </Text>
            {unsubscribeUrl && (
              <Text dir='rtl' style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#c4c4cc' }}>
                <Link href={unsubscribeUrl} style={{ color: '#c4c4cc', textDecoration: 'underline' }}>
                  הסרה מרשימת התפוצה
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
