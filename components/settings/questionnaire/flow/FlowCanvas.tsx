'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { buildFlow, ENDINGS, OPENING } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { addQuestion, keyOf, newRef, optionsOf, reactKey, type NewQuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import AddQuestionMenu from './AddQuestionMenu'
import FlowEmptyState from './FlowEmptyState'
import EndingsNode from './EndingsNode'
import OpeningNode from './OpeningNode'
import QuestionNode from './QuestionNode'
import { FlowEditorContext, type FlowEditor } from './flowContext'
import { DEFAULT_SIZE, edgeRoutes, layoutFlow, type Size } from './flowLayout'
import { ADD_QUESTION } from './removalFocus'
import { useKeepOpenBoxInView } from './keepOpenBoxInView'

const nodeTypes = { opening: OpeningNode, question: QuestionNode, endings: EndingsNode }
const MAX_QUESTIONS = 12

/** React Flow's screen-reader strings, in the product's language. */
const HEBREW_ARIA = {
  'node.a11yDescription.default': 'לחצו Enter כדי לבחור את התיבה. בתוך התיבה, Tab עובר בין השדות.',
  'node.a11yDescription.keyboardDisabled': 'בתוך התיבה, Tab עובר בין השדות.',
  'node.a11yDescription.ariaLiveMessage': () => '',
  'edge.a11yDescription.default': 'חץ בשיחה',
  'controls.ariaLabel': 'שליטה בתצוגת התרשים',
  'controls.zoomIn.ariaLabel': 'הגדלה',
  'controls.zoomOut.ariaLabel': 'הקטנה',
  'controls.fitView.ariaLabel': 'הצגת כל התרשים',
  'controls.interactive.ariaLabel': 'נעילת התרשים',
  'minimap.ariaLabel': 'מפה מוקטנת',
  'handle.ariaLabel': 'נקודת חיבור',
}

type Props = Omit<FlowEditor, 'reveal' | 'routedOptions' | 'focusRequest' | 'focusDone' | 'returnFocusTo'> & { selectedKey: string | null }

/**
 * The Flow view: the conversation drawn as a map. Boxes are edited in place;
 * arrows come from the draft (flowGraph.ts) and cannot be drawn or deleted by
 * hand, and boxes cannot be dragged: where a box sits is computed, and order
 * and conditions change only through named actions.
 */
export default function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({ selectedKey, ...editor }: Props) {
  const { model, edit, select, announce } = editor
  const flow = useReactFlow()
  const graph = useMemo(() => buildFlow(model), [model])
  // Boxes are identified by the render key, which survives a save giving a new
  // question its server id; the draft (and the map) speak in draft keys.
  const nodeIdOf = useMemo(() => {
    const byKey = new Map(model.questions.map((q) => [keyOf(q), reactKey(q)]))
    return (key: string) => byKey.get(key) ?? key
  }, [model])
  const ids = useMemo(() => [OPENING, ...graph.questions.map(nodeIdOf), ENDINGS], [graph, nodeIdOf])
  const keyOfNode = (nodeId: string) => {
    const q = model.questions.find((x) => reactKey(x) === nodeId)
    return q ? keyOf(q) : nodeId
  }
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  // A box just created opens with the cursor in its question text.
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  // After a deletion: the box (or "+ הוספת שאלה") that takes the cursor instead.
  const [returnFocus, setReturnFocus] = useState<string | null>(null)
  const [fitted, setFitted] = useState(false)

  const structure = `${ids.join('|')}#${graph.edges.map((e) => e.id).join('|')}`
  const sizeKey = ids.map((id) => (sizes[id] ? `${Math.round(sizes[id].width)}x${Math.round(sizes[id].height)}` : '?')).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flowEdges = useMemo(() => graph.edges.map((e) => ({ ...e, source: nodeIdOf(e.source), target: nodeIdOf(e.target) })), [graph, nodeIdOf])
  const layout = useMemo(() => layoutFlow(ids, flowEdges, sizes), [structure, sizeKey])

  const nodes: Node[] = ids.map((id) => ({
    id,
    type: id === OPENING ? 'opening' : id === ENDINGS ? 'endings' : 'question',
    position: layout[id],
    data: { questionKey: keyOfNode(id), nodeId: id },
    selected: id === selectedKey,
    ...(sizes[id] ? { measured: sizes[id] } : {}),
  }))
  const centre = (id: string) => layout[id].x + (sizes[id]?.width ?? 300) / 2
  const side = (from: string, to: string) => (centre(to) > centre(from) ? 'r' : 'l')
  const routes = edgeRoutes(
    flowEdges.map((e) => (e.option ? { ...e, side: side(e.source, e.target) } : e)),
    (id) => ({ top: layout[id].y, bottom: layout[id].y + (sizes[id] ?? DEFAULT_SIZE).height }),
    (source, option) => optionsOf(model.questions.find((x) => reactKey(x) === source) ?? model.questions[0]).findIndex((o) => keyOf(o) === option),
  )
  const edges: Edge[] = flowEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // An answer's route leaves from the side of the box that faces where it goes.
    sourceHandle: e.option ? `opt-${e.option}-${side(e.source, e.target)}` : 'next',
    targetHandle: 'in',
    type: 'smoothstep',
    pathOptions: routes[e.id],
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: e.option ? { stroke: '#6366f1', strokeWidth: 1.75 } : { stroke: '#9ca3af', strokeWidth: 1.5 },
    focusable: false,
  }))

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const nextSizes: Record<string, Size> = {}
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) nextSizes[c.id] = c.dimensions
    }
    if (Object.keys(nextSizes).length) {
      setSizes((s) => {
        const changed = Object.entries(nextSizes).some(([id, d]) => !s[id] || Math.abs(s[id].height - d.height) > 2 || Math.abs(s[id].width - d.width) > 2)
        return changed ? { ...s, ...nextSizes } : s
      })
    }
  }, [])

  // First view: everything fits once the boxes have been measured.
  const allMeasured = ids.every((id) => sizes[id])
  useEffect(() => {
    if (allMeasured && !fitted) {
      setFitted(true)
      // Start where the conversation starts, at a size that can be read; never
      // shrink a long questionnaire into an unreadable overview.
      const bounds = flow.getNodesBounds(ids)
      const box = document.querySelector('.react-flow')?.getBoundingClientRect()
      const zoom = box ? Math.max(0.75, Math.min(1, (box.width - 48) / bounds.width)) : 1
      const x = box ? (box.width - bounds.width * zoom) / 2 - bounds.x * zoom : 0
      void flow.setViewport({ x, y: 24 - bounds.y * zoom, zoom })
    }
  }, [allMeasured, fitted, flow])

  // A box opened for editing stays on screen (a just-created box is revealed by the effect after this).
  useKeepOpenBoxInView(selectedKey, pendingReveal, (id) => (layout[id] && sizes[id] ? { ...layout[id], ...sizes[id] } : null))

  // A box just created is brought into view once it exists and is measured.
  useEffect(() => {
    if (!pendingReveal || !sizes[pendingReveal]) return
    void flow.fitView({ nodes: [{ id: pendingReveal }], maxZoom: 1, duration: 300, padding: 0.4 })
    setPendingReveal(null)
  }, [pendingReveal, sizes, flow])

  // The confirmation dialog hands the cursor back to the deleted box's ×,
  // which no longer exists; once the map has re-rendered, it goes to the
  // chosen surviving control instead (a few frames: the box may be re-measured).
  useEffect(() => {
    if (!returnFocus) return
    let frames = 0
    let handle = 0
    const find = () =>
      returnFocus === ADD_QUESTION
        ? document.querySelector<HTMLElement>('.react-flow button[aria-haspopup="menu"]')
        : [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
            .find((n) => n.getAttribute('data-id') === returnFocus)
            ?.querySelector<HTMLElement>('button[aria-label^="עריכת"]')
    const attempt = () => {
      const el = find()
      el?.focus({ preventScroll: true })
      if (el && document.activeElement === el) return setReturnFocus(null)
      if (++frames < 30) handle = requestAnimationFrame(attempt)
      else setReturnFocus(null)
    }
    handle = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(handle)
  }, [returnFocus])

  // "question:option-side" for each answer arrow, so only the dot an arrow leaves from is drawn.
  const routedOptions = new Set(
    flowEdges.filter((e) => e.option).map((e) => `${keyOfNode(e.source)}:${e.option}-${side(e.source, e.target)}`),
  )
  const reveal = useCallback((nodeId: string) => {
    setPendingReveal(nodeId)
    setFocusRequest(nodeId)
  }, [])
  const context: FlowEditor = {
    ...editor,
    reveal,
    routedOptions,
    focusRequest,
    focusDone: () => setFocusRequest(null),
    returnFocusTo: (nodeId: string) => {
      if (nodeId !== ADD_QUESTION) setPendingReveal(nodeId)
      setReturnFocus(nodeId)
    },
  }
  const full = model.questions.length >= MAX_QUESTIONS
  // One way to add a question, from "+ הוספת שאלה לפני הסיום" or the empty state's "הוספת השאלה הראשונה".
  const addAtEnd = (kind: NewQuestionKind) => {
    const ref = newRef()
    edit((m) => addQuestion(m, kind, ref))
    announce('נוספה שאלה חדשה לפני הסיום')
    select(ref)
    reveal(ref)
  }

  return (
    <FlowEditorContext.Provider value={context}>
      <div dir='ltr' className='h-[calc(100vh-15rem)] min-h-[560px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          // A click on a control inside a box acts on that control (it may select
          // another box, e.g. a new follow-up); only a click on the box itself selects it.
          onNodeClick={(e, n) => {
            if (!(e.target as HTMLElement).closest('button, input, textarea, select, label, summary, a')) select(n.id)
          }}
          onPaneClick={() => select(null)}
          // Boxes sit where the conversation puts them. Moving one would look like
          // reordering the questionnaire, which it is not; order changes only
          // through "הקדמת / דחיית השאלה".
          nodesDraggable={false}
          nodesConnectable={false}
          // The box wrappers are not Tab stops: each box's own "עריכה" button and
          // fields are, so keyboard users move between things that do something.
          nodesFocusable={false}
          ariaLabelConfig={HEBREW_ARIA}
          edgesFocusable={false}
          deleteKeyCode={null}
          panOnScroll
          zoomOnScroll={false}
          minZoom={0.3}
          maxZoom={1.5}
          aria-label='מפת השאלון'
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} position='bottom-right' />
          {model.questions.length === 0 ? (
            <Panel position='bottom-center'>
              <FlowEmptyState onAdd={addAtEnd} />
            </Panel>
          ) : (
            <Panel position='top-right'>
              <div dir='rtl' className='flex items-center gap-2'>
                <AddQuestionMenu disabledReason={full ? 'אפשר עד 12 שאלות בשאלון.' : null} onAdd={addAtEnd} />
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </FlowEditorContext.Provider>
  )
}
