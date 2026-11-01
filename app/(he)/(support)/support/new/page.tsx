import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { coerceSupportKind } from '@/lib/support/vocabulary'
import { kindCopy } from '@/lib/support/localizedCopy'
import SupportRequestForm from '@/components/support/SupportRequestForm'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language (Hebrew outside the rollout). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('support.newRequest.title') }
}

/**
 * "Tell SocialCRM what happened" — not "create a support ticket".
 *
 * There is one visible input on this page. Subject and category are derived
 * server-side; priority, severity and routing do not exist in this product.
 *
 * PHASE 4 MOUNT POINT (do not implement early):
 *
 *   const parsed  = parseContextRef(params.ctx ?? null)
 *   const context = parsed ? await resolveSupportContext(parsed, user) : null
 *   {context && (
 *     <>
 *       <p>זיהינו בעיה ב־…</p>
 *       <SupportContextCard facts={context.facts} />
 *     </>
 *   )}
 *   <SupportRequestForm kind={kind} bodyOptional={context != null} />
 *
 * The `ctx` param is accepted and IGNORED today. It is never trusted as a
 * payload — here or in Phase 4, where it is re-resolved server-side against the
 * session's agency.
 */
export default async function NewSupportRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; ctx?: string }>
}) {
  const user = await requireAgencyUser()
  const params = await searchParams
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)

  // Validated against the closed union; anything unknown becomes a question.
  // Selects COPY only — no authorization, routing or tenant decision reads it.
  const kind = coerceSupportKind(params.kind)
  void params.ctx
  const copy = kindCopy(kind, locale)

  return (
    <>
      <header className='mb-2'>
        <h1 className='text-2xl font-bold text-ink'>{copy.formTitle}</h1>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          {t('support.newRequest.intro')}
        </p>
      </header>

      {/* Phase 4: SupportContextCard mounts here, above the form. */}

      <SupportRequestForm kind={kind} fieldLabel={copy.formTitle} />
    </>
  )
}
