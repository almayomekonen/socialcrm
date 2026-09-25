import BillingArtwork from './BillingArtwork'

/**
 * The shell the card-setup experience lives in, shared by the welcome modal and
 * the standalone billing page so the two cannot drift into different products.
 *
 * Split layout. The document is RTL, so the first child lands on the RIGHT:
 * that is the decorative panel, and the form follows on the LEFT, which is
 * where the eye goes after the heading. The artwork is decoration and stays
 * decoration — no marketing copy, no second call to action competing with the
 * one real button.
 *
 * On phones the artwork is removed from the DOM entirely rather than hidden
 * with CSS: it is 440×560 of SVG that nobody on a 390px screen will see, and a
 * decorative panel should not cost a mobile customer a single byte or a single
 * frame of layout. The form then owns the full width.
 *
 * `eyebrow` / `title` / `lead` carry the account-specific hierarchy, because a
 * comped account, a new trial and a card replacement are three different
 * messages and only the caller knows which one is true.
 */
export default function CardSetupPanel({
  eyebrow,
  title,
  lead,
  children,
  footnote,
}: {
  eyebrow?: string
  title: string
  lead?: string
  children: React.ReactNode
  footnote?: React.ReactNode
}) {
  return (
    <div className='billing-panel'>
      {/* Decorative half. desktop-only: see the note above. */}
      <div className='billing-panel__art' aria-hidden='true'>
        <BillingArtwork className='billing-panel__art-svg' />
      </div>

      <div className='billing-panel__form'>
        <div className='billing-panel__head'>
          {eyebrow && <p className='billing-panel__eyebrow'>{eyebrow}</p>}
          <h2 className='billing-panel__title'>{title}</h2>
          {lead && <p className='billing-panel__lead'>{lead}</p>}
        </div>

        <div className='billing-panel__body'>{children}</div>

        {footnote && <div className='billing-panel__foot'>{footnote}</div>}
      </div>
    </div>
  )
}
