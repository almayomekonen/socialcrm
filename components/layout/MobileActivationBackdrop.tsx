import ActivationBrand, { ACTIVATION_BG } from '@/components/activation/ActivationBrand'

/**
 * Loading backdrop for the mobile activation gate. Rendered as the Suspense
 * fallback so the mobile screen is fully covered from the first painted frame —
 * the dashboard can never flash behind the gate while it resolves. Visually
 * identical to ActivationFlow (same background + brand), so the handoff is invisible.
 */
export default function MobileActivationBackdrop() {
  return (
    <div
      aria-hidden='true'
      className='fixed inset-0 z-9999 flex items-center justify-center overflow-hidden px-6 desktop:hidden'
      style={{ background: ACTIVATION_BG }}
    >
      <ActivationBrand />
    </div>
  )
}
