import { describe, expect, it } from 'vitest'
import { linkifyText } from '@/lib/inbox/linkifyText'

describe('linkifyText', () => {
  it('returns plain text untouched', () => {
    expect(linkifyText('שלום, מה נשמע?')).toEqual([{ kind: 'text', value: 'שלום, מה נשמע?' }])
  })

  it('links a bare URL message', () => {
    const url = 'https://skillreal.com/blog/job/senior-software-engineer/'
    expect(linkifyText(url)).toEqual([{ kind: 'link', value: url, href: url }])
  })

  it('links a URL inside Hebrew text and drops trailing punctuation', () => {
    expect(linkifyText('תסתכל פה https://x.com/a. תודה')).toEqual([
      { kind: 'text', value: 'תסתכל פה ' },
      { kind: 'link', value: 'https://x.com/a', href: 'https://x.com/a' },
      { kind: 'text', value: '. תודה' },
    ])
  })

  it('prefixes www links with https', () => {
    expect(linkifyText('www.example.com')).toEqual([
      { kind: 'link', value: 'www.example.com', href: 'https://www.example.com' },
    ])
  })

  it('never links non-http schemes', () => {
    expect(linkifyText('javascript:alert(1)')).toEqual([{ kind: 'text', value: 'javascript:alert(1)' }])
  })

  it('handles multiple links', () => {
    const segs = linkifyText('a https://a.com b http://b.com')
    expect(segs.filter((s) => s.kind === 'link').map((s) => s.value)).toEqual(['https://a.com', 'http://b.com'])
  })
})
