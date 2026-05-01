import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { ReactNode } from 'react'

type Props = {
  preview: string
  children: ReactNode
}

export function EmailLayout({ preview, children }: Props) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>

      <Body
        dir="rtl"
        style={{
          backgroundColor: '#f8fafc',
          margin: 0,
          padding: 0,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <Container
          style={{
            margin: '40px auto',
            maxWidth: '560px',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Header */}
          <Section
            style={{
              backgroundColor: '#4f46e5',
              padding: '32px 24px',
              textAlign: 'center',
            }}
          >
            <Text
              dir="ltr"
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 'bold',
                color: '#ffffff',
              }}
            >
              SocialCRM
            </Text>

            <Text
              dir="rtl"
              style={{
                margin: '6px 0 0 0',
                fontSize: '14px',
                color: '#e0e7ff',
              }}
            >
              כל הלידים שלך במקום אחד
            </Text>
          </Section>

          {/* Content */}
          <Section
            style={{
              padding: '32px 24px',
            }}
          >
            {children}
          </Section>

          {/* Footer */}
          <Section
            style={{
              borderTop: '1px solid #f1f5f9',
              backgroundColor: '#f8fafc',
              padding: '20px',
              textAlign: 'center',
            }}
          >
            <Text
              dir="rtl"
              style={{
                margin: 0,
                fontSize: '12px',
                color: '#64748b',
              }}
            >
              מערכת <span dir="ltr">SocialCRM</span> לניהול לידים לעסקים קטנים
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}