import { phoneCore, normalizeEmail, normalizeIdNum } from './normalizeContact'

export type DuplicateConfidence = 'certain' | 'probable' | 'possible'

export type DuplicateSignal = 'idNum' | 'phone' | 'email'

export type DuplicateMatch = {
  id: number
  name: string
  status: string | null
  phone: string | null
  email: string | null
  confidence: DuplicateConfidence
  signals: DuplicateSignal[]
}

export type NormalizedQuery = {
  phones: string[]
  email: string | null
  idNum: string | null
  firstName: string | null
  lastName: string | null
}

export type DuplicateCandidate = {
  id: number
  firstName: string | null
  lastName: string | null
  name: string | null
  status: string | null
  phone: string | null
  secPhone: string | null
  email: string | null
  idNum: string | null
}

const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = { certain: 0, probable: 1, possible: 2 }

export function compareMatches(a: DuplicateMatch, b: DuplicateMatch): number {
  const byConfidence = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  return byConfidence !== 0 ? byConfidence : b.signals.length - a.signals.length
}

function namesLikelyMatch(q: NormalizedQuery, cand: DuplicateCandidate): boolean {
  const qLast = q.lastName?.trim().toLowerCase()
  const cLast = cand.lastName?.trim().toLowerCase()
  if (qLast && cLast && qLast === cLast) return true

  const qFull = [q.firstName, q.lastName].filter(Boolean).join(' ').trim().toLowerCase()
  const cFull = (cand.name ?? [cand.firstName, cand.lastName].filter(Boolean).join(' ')).trim().toLowerCase()
  return !!qFull && qFull === cFull
}

export function scoreCandidate(q: NormalizedQuery, cand: DuplicateCandidate): DuplicateMatch | null {
  const inputCores = new Set(q.phones.map((p) => p.slice(-9)))
  const candCores = [phoneCore(cand.phone), phoneCore(cand.secPhone)].filter((c): c is string => !!c)
  const phoneMatch = candCores.some((c) => inputCores.has(c))

  const emailMatch = !!q.email && normalizeEmail(cand.email) === q.email
  const idMatch = !!q.idNum && normalizeIdNum(cand.idNum) === q.idNum

  const signals: DuplicateSignal[] = []
  if (idMatch) signals.push('idNum')
  if (phoneMatch) signals.push('phone')
  if (emailMatch) signals.push('email')
  if (signals.length === 0) return null

  let confidence: DuplicateConfidence
  if (idMatch || phoneMatch) confidence = 'certain'
  else if (emailMatch && namesLikelyMatch(q, cand)) confidence = 'probable'
  else confidence = 'possible'

  return {
    id: cand.id,
    name: cand.name || [cand.firstName, cand.lastName].filter(Boolean).join(' ').trim(),
    status: cand.status,
    phone: cand.phone,
    email: cand.email,
    confidence,
    signals,
  }
}
