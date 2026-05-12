export type ParsedUserAgent = {
  browser: string
  os: string
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = (ua ?? '').trim()
  if (!s) return { browser: 'לא ידוע', os: 'לא ידוע' }

  return { browser: detectBrowser(s), os: detectOs(s) }
}

function detectBrowser(s: string): string {
  if (/Edg\//i.test(s)) return 'Edge'
  if (/OPR\/|Opera/i.test(s)) return 'Opera'
  if (/Firefox\//i.test(s)) return 'Firefox'
  if (/Chrome\//i.test(s) && !/Edg\/|OPR\//i.test(s)) return 'Chrome'
  if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) return 'Safari'
  return 'דפדפן אחר'
}

function detectOs(s: string): string {
  if (/Windows NT/i.test(s)) return 'Windows'
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS'
  if (/Android/i.test(s)) return 'Android'
  if (/Mac OS X|Macintosh/i.test(s)) return 'macOS'
  if (/Linux/i.test(s)) return 'Linux'
  return 'מערכת אחרת'
}
