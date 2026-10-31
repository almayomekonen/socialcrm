import { FacebookMark, GoogleMark, SOCIAL_BTN } from './SocialMarks'

/**
 * The Google / Facebook buttons under the sign-in and registration forms. Moved
 * out of `Login.tsx` unchanged (file-size rule): `Login` still owns every SDK
 * call, the GIS render into `#gglBtn` and the Facebook click handler; this only
 * draws the buttons — the phone's matched pair or the desktop's GIS slot.
 */
export default function SocialButtons({
  phone,
  facebook,
  onFacebookClick,
}: {
  phone: boolean
  facebook: boolean
  onFacebookClick: () => void
}) {
  return phone ? (
    <div className='flex w-full flex-col gap-3' dir='ltr' data-testid='social-auth-buttons'>
      <div className='relative h-11 w-full'>
        <div aria-hidden className={SOCIAL_BTN}>
          <GoogleMark />
          <span>כניסה באמצעות Google</span>
        </div>
        <div id='gglBtn' className='absolute inset-0 flex items-center overflow-hidden opacity-0' dir='ltr' />
      </div>
      {facebook && (
        <button type='button' dir='ltr' className={SOCIAL_BTN} onClick={onFacebookClick}>
          <FacebookMark />
          <span>כניסה באמצעות Facebook</span>
        </button>
      )}
    </div>
  ) : (
    <>
      <div id='gglBtn' className='flex w-full justify-center' dir='ltr'></div>
      {facebook && (
        <button
          type='button'
          dir='ltr'
          className='relative mt-3 flex h-10 w-full items-center justify-center rounded border border-input bg-white px-12 text-[14px] font-medium leading-none text-[#1f1f1f] hover:bg-gray-50'
          onClick={onFacebookClick}
        >
          <FacebookMark />
          <span>כניסה באמצעות Facebook</span>
        </button>
      )}
    </>
  )
}
