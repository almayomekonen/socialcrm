/**
 * The 404 for `/en/*` and `/ar/*`, answered by the proxy.
 *
 * Why the proxy and not `not-found.tsx`: on Next 16.3 with `cacheComponents`,
 * `notFound()` thrown from a page (catch-all or static) is served as an empty
 * `<html id="__next_error__">` document with no `lang`, `dir` or body, and a
 * proxy rewrite to a 404 page drops the status to 200. Only unmatched URLs
 * render properly, and those all reach the single Hebrew
 * `app/global-not-found.tsx`. Next's own guidance for a guaranteed 404 status
 * is to decide in the proxy, so the proxy answers unknown locale paths with
 * this static document and a real 404.
 *
 * The page is the Hebrew 404's look (Next's default not-found UI), written out
 * here. It is static text: nothing from the request is echoed into it.
 */

export type MarketingLocale = 'en' | 'ar'

/**
 * Every page that exists under `app/(en)/en` and `app/(ar)/ar`, as URL paths.
 * Anything else under `/en/` or `/ar/` is a 404. A test compares this list with
 * the page files on disk, so a new locale page fails the suite until it is
 * listed here.
 */
export const LOCALE_PAGES: Record<MarketingLocale, readonly string[]> = {
  en: ['/en'],
  ar: ['/ar'],
}

const COPY: Record<MarketingLocale, { dir: 'ltr' | 'rtl'; message: string }> = {
  en: { dir: 'ltr', message: 'This page could not be found.' },
  ar: { dir: 'rtl', message: 'لم يتم العثور على هذه الصفحة.' },
}

/** The locale tree a path belongs to, or null for every non-locale path. */
export function localeOfPath(pathname: string): MarketingLocale | null {
  for (const locale of Object.keys(LOCALE_PAGES) as MarketingLocale[]) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return locale
  }
  return null
}

export function isLocalePage(locale: MarketingLocale, pathname: string): boolean {
  return LOCALE_PAGES[locale].includes(pathname)
}

// Next's default not-found styles, with the divider and spacing as logical
// properties so they sit between the code and the message in RTL as well.
const STYLE =
  'body{color:#000;background:#fff;margin:0}' +
  '.e{font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center}' +
  '.e h1{display:inline-block;margin:0;margin-inline-end:20px;padding:0;padding-inline-end:23px;font-size:24px;font-weight:500;vertical-align:top;line-height:49px;border-inline-end:1px solid rgba(0,0,0,.3)}' +
  '.e h1+div{display:inline-block}' +
  '.e h2{font-size:14px;font-weight:400;line-height:49px;margin:0}' +
  '@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.e h1{border-inline-end-color:rgba(255,255,255,.3)}}'

export function localeNotFoundHtml(locale: MarketingLocale): string {
  const { dir, message } = COPY[locale]
  return (
    `<!DOCTYPE html><html lang="${locale}" dir="${dir}"><head>` +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    `<title>404: ${message}</title>` +
    '<meta name="robots" content="noindex"/>' +
    '<link rel="icon" href="/media/fav.svg"/>' +
    `<style>${STYLE}</style>` +
    '</head><body>' +
    `<main id="main-content" class="e"><div><h1>404</h1><div><h2>${message}</h2></div></div></main>` +
    '</body></html>'
  )
}

/** The proxy's answer for an unknown locale path: the static page with a real 404. */
export function localeNotFoundResponse(locale: MarketingLocale): Response {
  return new Response(localeNotFoundHtml(locale), {
    status: 404,
    // Same caching as the Hebrew 404.
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' },
  })
}
