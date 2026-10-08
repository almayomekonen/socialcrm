/**
 * The questionnaire as a conversation map: which question follows which, and
 * which answer leads where. DERIVED from the draft, never stored.
 *
 * Nothing here decides routing. Every route is walked with the runtime's own
 * `nextStepAfter` over the definition the draft converts to, so an arrow on
 * the map is exactly a turn a customer can take. The map therefore cannot
 * disagree with the engine, and moving a box on the canvas changes nothing:
 * position is presentation, order and conditions are the draft's.
 *
 * Simplification (the anti-spaghetti rule): a choice question gets ONE plain
 * "continue" arrow for the answers that simply continue, and an arrow from an
 * individual answer only when that answer leads somewhere else. All endings
 * are one node; which customers get which ending is said there in words.
 */
import { nextStepAfter, type QuestionnaireDefinition } from '../definition'
import { previewDefinition } from './editorView'
import type { BuilderQuestionnaire } from './model'

export const OPENING = 'opening'
export const ENDINGS = 'endings'

export type FlowEdge = {
  id: string
  source: string
  target: string
  /** Set when the arrow leaves from one answer: the option's key. */
  option?: string
}

export type FlowGraph = {
  /** Question keys in draft order (the runtime order). */
  questions: string[]
  edges: FlowEdge[]
  /** Questions no customer can reach as the draft stands. */
  unreachable: string[]
}

/** Enough to walk every route of any questionnaire the V1 runtime accepts. */
const MAX_ROUTES = 2000

export function buildFlow(model: BuilderQuestionnaire): FlowGraph {
  const definition = previewDefinition(model)
  const questions = model.questions.map((q) => q.id ?? q.ref ?? '')
  if (!definition) return linear(questions)
  return fromRoutes(definition, questions)
}

/** A draft the converter refuses (only possible mid-edit) is drawn in order, unbranched. */
function linear(questions: string[]): FlowGraph {
  const chain = [OPENING, ...questions, ENDINGS]
  return {
    questions,
    edges: chain.slice(1).map((target, i) => ({ id: `${chain[i]}->${target}`, source: chain[i], target })),
    unreachable: [],
  }
}

function fromRoutes(definition: QuestionnaireDefinition, questions: string[]): FlowGraph {
  // For each question, where each answer goes ('*' = any answer, for free text).
  const next = new Map<string, Map<string, Set<string>>>()
  const visited = new Set<string>()
  const record = (from: string, answer: string, to: string) => {
    if (!next.has(from)) next.set(from, new Map())
    const byAnswer = next.get(from) as Map<string, Set<string>>
    if (!byAnswer.has(answer)) byAnswer.set(answer, new Set())
    ;(byAnswer.get(answer) as Set<string>).add(to)
  }

  let routes = 0
  const walk = (answers: Record<string, string[]>, after: string | null, from: string, answer: string) => {
    if (routes > MAX_ROUTES) return
    const step = nextStepAfter(definition, answers, after)
    record(from, answer, step ? step.id : ENDINGS)
    if (!step) {
      routes++
      return
    }
    if (visited.has(`${step.id}|${JSON.stringify(answers)}`)) return
    visited.add(`${step.id}|${JSON.stringify(answers)}`)
    if (step.type === 'choice') {
      for (const option of step.options) walk({ ...answers, [step.id]: [option.id] }, step.id, step.id, option.id)
    } else {
      walk({ ...answers, [step.id]: ['answer'] }, step.id, step.id, '*')
    }
  }
  walk({}, null, OPENING, '*')

  const edges: FlowEdge[] = []
  const add = (source: string, target: string, option?: string) => {
    const id = option ? `${source}:${option}->${target}` : `${source}->${target}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, ...(option ? { option } : {}) })
  }
  for (const [from, byAnswer] of next) {
    const step = definition.steps.find((s) => s.id === from)
    if (!step || step.type !== 'choice') {
      for (const targets of byAnswer.values()) for (const t of targets) add(from, t)
      continue
    }
    // The plain arrow goes where answers WITHOUT a follow-up of their own go
    // (a target that is not conditioned on this question); a follow-up is
    // reached from its answer. If every answer has one, the most common wins.
    const followUpOf = (t: string) => definition.steps.find((s) => s.id === t)?.when?.step === from
    const tally = new Map<string, number>()
    for (const targets of byAnswer.values()) for (const t of targets) tally.set(t, (tally.get(t) ?? 0) + 1)
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    const usual = ranked.find((t) => !followUpOf(t)) ?? ranked[0]
    for (const [option, targets] of byAnswer) {
      for (const t of targets) (t === usual ? add(from, t) : add(from, t, option))
    }
  }

  const reached = new Set([...next.keys()])
  return { questions, edges, unreachable: questions.filter((q) => !reached.has(q)) }
}
