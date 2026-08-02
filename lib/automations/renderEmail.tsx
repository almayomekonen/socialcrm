import * as React from 'react'
import { Body, Container, Head, Hr, Html, Link, Text } from '@react-email/components'
import { render } from '@react-email/render'

/**
 * Customer-automation email rendering: closed-set variable substitution with
 * graceful fallbacks (spec §7: "שלום דנה," degrades to "שלום,"), then a
 * minimal RTL shell with the automatic footer — business name + the mandatory
 * unsubscribe link (ADR-003). No layout decisions belong to the user; no
 * platform template is imported (spec §0).
 */

export type EmailVariableValues = {
  leadFirstName: string | null
  businessName: string | null
  repName: string | null
}

const TOKEN_TO_FIELD: Array<{ token: string; field: keyof EmailVariableValues }> = [
  { token: 'שם הליד', field: 'leadFirstName' },
  { token: 'שם העסק', field: 'businessName' },
  { token: 'שם הנציג', field: 'repName' },
]

export function substituteVariables(content: string, vars: EmailVariableValues): string {
  let out = content
  const business = vars.businessName?.trim() || 'העסק'
  const resolved: Record<keyof EmailVariableValues, string> = {
    leadFirstName: vars.leadFirstName?.trim() || '',
    businessName: business,
    repName: vars.repName?.trim() || business,
  }
  for (const { token, field } of TOKEN_TO_FIELD) {
    out = out.split(`{{${token}}}`).join(resolved[field])
  }
  // Graceful degradation when a value was empty: "שלום ," → "שלום," and no
  // doubled spaces mid-line.
  return out
    .replace(/ +,/g, ',')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+$/gm, '')
}

export type RenderedEmail = { subject: string; html: string; text: string }

function AutomationEmail(props: { paragraphs: string[]; businessName: string; unsubscribeUrl: string }) {
  return (
    <Html dir="rtl" lang="he">
      <Head />
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '560px' }}>
          {props.paragraphs.map((p, i) => (
            <Text key={i} style={{ fontSize: '15px', lineHeight: '1.6', whiteSpace: 'pre-line', textAlign: 'right' }}>
              {p}
            </Text>
          ))}
          <Hr style={{ margin: '24px 0' }} />
          <Text style={{ fontSize: '12px', color: '#6b7280', textAlign: 'right' }}>
            הודעה זו נשלחה מטעם {props.businessName}.{' '}
            <Link href={props.unsubscribeUrl} style={{ color: '#6b7280', textDecoration: 'underline' }}>
              הסרה מרשימת התפוצה
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export async function renderAutomationEmail(input: {
  subject: string
  body: string
  vars: EmailVariableValues
  unsubscribeUrl: string
}): Promise<RenderedEmail> {
  const subject = substituteVariables(input.subject, input.vars)
  const bodyText = substituteVariables(input.body, input.vars)
  const businessName = input.vars.businessName?.trim() || 'העסק'
  const paragraphs = bodyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const element = (
    <AutomationEmail paragraphs={paragraphs} businessName={businessName} unsubscribeUrl={input.unsubscribeUrl} />
  )
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject, html, text }
}
