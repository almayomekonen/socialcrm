import type { BusinessStateKind } from '../businessState'

export type ObservationCategory = 'cluster'

export interface Candidate {
  category: ObservationCategory
  condition: BusinessStateKind
  memberRefIds: string[]
  scale: number
  deviation: number
  support: number
}

export interface ScoredCandidate extends Candidate {
  materiality: number
  breakdown: { scale: number; support: number; gate: number; score: number }
}

export interface Observation {
  category: ObservationCategory
  statement: string
  evidenceRefIds: string[]
  materiality: number
}
