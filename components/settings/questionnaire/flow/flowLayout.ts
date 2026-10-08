/**
 * Where each box sits on the canvas. Presentation only: computed from the
 * flow map and the boxes' measured sizes, never saved, never read by the
 * runtime. Boxes are not draggable, so this is always where they sit.
 *
 * Top to bottom, the order a conversation is read. dagre orders siblings left
 * to right in insertion order; the result is mirrored so the first answer's
 * route sits on the right, where a Hebrew reader starts.
 */
import dagre from '@dagrejs/dagre'
import type { FlowEdge } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

export const DEFAULT_SIZE: Size = { width: 340, height: 220 }

/** The vertical gap between rows of boxes. */
export const RANK_GAP = 64

/** How strongly an answer's route pulls its follow-up next to the question (dagre edge weight). */
const ANSWER_ROUTE_WEIGHT = 8

export function layoutFlow(nodeIds: string[], edges: FlowEdge[], sizes: Record<string, Size>): Record<string, Point> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: RANK_GAP, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of nodeIds) g.setNode(id, { ...(sizes[id] ?? DEFAULT_SIZE) })
  // An answer's own route (to its follow-up) is kept short: the follow-up sits
  // right under the question that asks it, and the route then rejoins. Without
  // this, dagre is as happy to put a follow-up beside the ending (its other
  // edge) as beside its question. Presentation only: the edges are unchanged.
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, { weight: e.option ? ANSWER_ROUTE_WEIGHT : 1 })
  dagre.layout(g)

  const out: Record<string, Point> = {}
  for (const id of nodeIds) {
    const n = g.node(id)
    const size = sizes[id] ?? DEFAULT_SIZE
    // dagre gives centres; React Flow positions top-left corners. Mirror x for RTL.
    out[id] = { x: -n.x - size.width / 2, y: n.y - size.height / 2 }
  }
  return out
}

/**
 * Lanes for the arrows, so two arrows never draw over each other. Presentation
 * only: which box an arrow joins is the map's; this only says where its
 * bends go (React Flow smoothstep `offset` and `stepPosition`).
 *
 * In the gap above a row of boxes, measured up from the boxes it reaches:
 *   - an answer's own arrow (blue) leaves its dot sideways and runs in the
 *     lowest band: 16, 28, 40… px, one lane per answer leaving the same side
 *     of the same question (the upper answer takes the outer lane, so they
 *     do not cross);
 *   - a "continue" arrow (gray) to the next row turns right under its box;
 *   - a "continue" arrow that skips rows turns above the answer lanes, so it
 *     runs down its own column instead of behind a box it does not go to.
 * A straight arrow has no bend and is unchanged.
 */
const GRAY_OFFSET = 10
const ANSWER_LANE = 16
const ANSWER_LANE_STEP = 12
const LONG_TURN = 46

export type RoutedEdge = { id: string; source: string; target: string; option?: string; side?: 'l' | 'r' }
export type EdgeRoute = { offset: number; stepPosition?: number }

export function edgeRoutes(
  edges: RoutedEdge[],
  box: (id: string) => { top: number; bottom: number },
  optionIndex: (source: string, option: string) => number,
): Record<string, EdgeRoute> {
  const routes: Record<string, EdgeRoute> = {}
  const siblings = new Map<string, RoutedEdge[]>()
  for (const e of edges) {
    if (e.option) {
      const group = `${e.source}|${e.side ?? 'l'}`
      siblings.set(group, [...(siblings.get(group) ?? []), e])
      continue
    }
    // smoothstep turns at stepPosition between the two points `offset` away from the boxes.
    const from = box(e.source).bottom + GRAY_OFFSET
    const to = box(e.target).top - GRAY_OFFSET
    const longArrow = to - from > RANK_GAP * 2
    const turn = longArrow ? box(e.target).top - LONG_TURN : from
    routes[e.id] = { offset: GRAY_OFFSET, stepPosition: to > from ? Math.min(1, Math.max(0, (turn - from) / (to - from))) : 0.5 }
  }
  for (const group of siblings.values()) {
    const ordered = [...group].sort((a, b) => optionIndex(a.source, a.option as string) - optionIndex(b.source, b.option as string))
    ordered.forEach((e, i) => {
      routes[e.id] = { offset: ANSWER_LANE + ANSWER_LANE_STEP * (ordered.length - 1 - i) }
    })
  }
  return routes
}
