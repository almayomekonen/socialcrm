/**
 * Local (non-redirect) OAuth error page: used whenever there is no trusted
 * redirect_uri to send the error to. Generic Hebrew wording only — never the
 * client id, the reason code, or anything internal.
 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const GENERIC_OAUTH_ERROR = 'לא ניתן להשלים את החיבור. חזור לאפליקציה שממנה התחלת ונסה שוב.'

export function oauthErrorPage(status: number, message: string = GENERIC_OAUTH_ERROR): Response {
  const html =
    '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>SocialCRM</title></head>' +
    `<body><main><h1>החיבור לא הושלם</h1><p>${esc(message)}</p>` +
    '<p><a href="/dashboard">חזרה ל-SocialCRM</a></p></main></body></html>'
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
