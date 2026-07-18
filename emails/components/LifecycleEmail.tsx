import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from '@react-email/components'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/**
 * Shared premium shell for lifecycle / automation emails. Every such email uses
 * this exact structure and spacing (headline → opening → value → action → CTA),
 * so they all share one visual language. Self-contained on purpose: it does not
 * reuse EmailLayout, so redesigning it never affects the existing transactional
 * emails (welcome, magic-link, invoice, feedback).
 */
export type LifecycleEmailProps = {
  preview: string
  headline: string
  opening: string
  value: string
  action: string
  ctaLabel: string
  ctaUrl: string
  unsubscribeUrl?: string
}

const paragraph = {
  margin: '20px 0 0 0',
  textAlign: 'right' as const,
  fontSize: '16px',
  lineHeight: 1.8,
  color: '#3f3f46',
}

export function LifecycleEmail({ preview, headline, opening, value, action, ctaLabel, ctaUrl, unsubscribeUrl }: LifecycleEmailProps) {
  return (
    <Html lang='he' dir='rtl'>
      <Head />
      <Preview>{preview}</Preview>

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
          {/* Header — reduced height, elegant wordmark */}
          <Section style={{ backgroundColor: '#4f46e5', padding: '22px 40px', textAlign: 'center' }}>
            <Text style={{ margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '0.4px', color: '#ffffff' }}>SocialCRM</Text>
          </Section>

          {/* Content */}
          <Section style={{ padding: '44px 40px 8px 40px' }}>
            <Heading
              dir='rtl'
              style={{ margin: 0, textAlign: 'right', fontSize: '25px', lineHeight: 1.35, fontWeight: 700, letterSpacing: '-0.2px', color: '#18181b' }}
            >
              {headline}
            </Heading>

            <Text dir='rtl' style={{ ...paragraph, marginTop: '18px', color: '#52525b' }}>{opening}</Text>
            <Text dir='rtl' style={paragraph}>{value}</Text>
            <Text dir='rtl' style={paragraph}>{action}</Text>
          </Section>

          {/* CTA — generous space before and after */}
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
              {ctaLabel}
            </Button>
          </Section>

          {/* Footer — small and light */}
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
