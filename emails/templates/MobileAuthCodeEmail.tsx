import * as React from 'react'

/**
 * The six-digit sign-in code for the mobile app.
 *
 * A SEPARATE TEMPLATE FROM `MagicLinkEmail`, deliberately. That email's entire
 * job is to be clicked; this one must NOT be — a code is typed into an app that
 * is already open. Reusing the magic-link body would invite the recipient to
 * hunt for a link that is not there.
 *
 * ⚠️ NO LINK, ANYWHERE. Not even a "open the app" button: a code plus a link is
 * how phishing gets a foothold, because it trains the recipient to click. The
 * only action is to return to an app they already launched.
 */
export default function MobileAuthCodeEmail({
  code,
  expiresInMinutes,
}: {
  code: string
  expiresInMinutes: number
}) {
  return (
    <div dir="rtl" style={{ fontFamily: 'Arial, sans-serif', color: '#0a2540', padding: '24px' }}>
      <h1 style={{ fontSize: '20px', margin: '0 0 8px' }}>קוד ההתחברות שלך</h1>

      <p style={{ fontSize: '15px', color: '#425466', margin: '0 0 20px' }}>
        הזן את הקוד הזה באפליקציית SocialCRM כדי להתחבר.
      </p>

      <div
        style={{
          fontSize: '32px',
          fontWeight: 700,
          letterSpacing: '8px',
          padding: '16px 24px',
          background: '#f6f9fc',
          border: '1px solid #e3e8ee',
          borderRadius: '8px',
          textAlign: 'center',
          direction: 'ltr',
        }}
      >
        {code}
      </div>

      <p style={{ fontSize: '13px', color: '#697386', margin: '20px 0 0' }}>
        הקוד תקף ל-{expiresInMinutes} דקות וניתן לשימוש פעם אחת בלבד.
      </p>

      {/* The only safe instruction when someone did not ask for this. */}
      <p style={{ fontSize: '13px', color: '#697386', margin: '8px 0 0' }}>
        אם לא ביקשת קוד, אפשר להתעלם מההודעה. אף אחד לא נכנס לחשבון שלך.
      </p>
    </div>
  )
}
