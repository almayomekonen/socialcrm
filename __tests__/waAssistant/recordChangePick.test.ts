import { describe, expect, it } from 'vitest'
import { contentWords, lineOf, pickTarget, titleScore } from '@/lib/waAssistant/recordChanges/pick'

const score = (t: { title: string }, text: string) => titleScore(t.title, contentWords(text))
const A = { title: 'לשלוח הצעה' }
const B = { title: 'להתקשר ללקוח' }

describe('which record the owner means', () => {
  it('reads a line number or an ordinal, masculine or feminine', () => {
    expect(lineOf('2')).toBe(1)
    expect(lineOf('השנייה')).toBe(1)
    expect(lineOf('המשימה הראשונה')).toBe(0)
    expect(lineOf('את השלישית')).toBe(2)
    expect(lineOf('לשלוח הצעה לדני מחר בבוקר')).toBeNull()
  })
  it('never guesses between two with no description', () => {
    expect(pickTarget([A, B], { answer: null, match: null, score })).toEqual({ many: [A, B] })
    expect(pickTarget([A, B], { answer: null, match: 'המשימה', score })).toEqual({ many: [A, B] })
  })
  it('uses the only candidate when nothing was said against it', () => {
    expect(pickTarget([A], { answer: null, match: null, score })).toEqual({ one: A })
  })
  it('asks rather than assume, when the only candidate does not fit the description', () => {
    expect(pickTarget([A], { answer: null, match: 'לחדש ביטוח', score })).toEqual({ many: [A] })
    expect(pickTarget([A], { answer: 'כן', match: 'לחדש ביטוח', score })).toEqual({ one: A })
  })
  it('picks the one that fits, ignoring a tie', () => {
    expect(pickTarget([A, B], { answer: null, match: 'ההצעה', score })).toEqual({ one: A })
    expect(pickTarget([A, A], { answer: null, match: 'הצעה', score })).toEqual({ many: [A, A] })
  })
  it('a line outside the list is not an answer', () => {
    expect(pickTarget([A, B], { answer: '7', match: null, score })).toEqual({ many: [A, B] })
  })
  it('reports when there is nothing to choose from', () => {
    expect(pickTarget([], { answer: null, match: 'x', score })).toEqual({ none: true })
  })
})
