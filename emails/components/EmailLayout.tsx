import { Body, Container, Head, Html, Preview, Section, Text, Tailwind } from '@react-email/components'
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
      <Tailwind>
        <Body dir="rtl" lang="he" className="bg-slate-50 font-sans">
          <Container dir="rtl" className="mx-auto my-10 max-w-[560px] overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            <Section className="bg-linear-to-br from-indigo-600 to-indigo-700 px-10 py-8 text-center">
              <Text dir="ltr" className="m-0 text-2xl font-bold tracking-tight text-white">SocialCRM</Text>
              <Text dir="rtl" className="m-0 mt-1 text-sm text-indigo-100">כל הלידים שלך במקום אחד</Text>
            </Section>

            <Section className="px-10 py-8">{children}</Section>

            <Section className="border-0 border-t border-solid border-slate-100 bg-slate-50 px-10 py-5 text-center">
              <Text dir="rtl" className="m-0 text-xs text-slate-500">
                מערכת <span dir="ltr">SocialCRM</span> לניהול לידים לעסקים קטנים
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
