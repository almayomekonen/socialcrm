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
import { Btn } from '@/lib/btns/Btn'
import { buildFlow, ENDINGS, OPENING } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { addQuestion, keyOf, newRef, reactKey } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import AddQuestionMenu from './AddQuestionMenu'
import EndingsNode from './EndingsNode'
import OpeningNode from './OpeningNode'
import QuestionNode from './QuestionNode'
import { FlowEditorContext, type FlowEditor } from './flowContext'
import { layoutFlow, type Point, type Size } from './flowLayout'

const nodeTypes = { opening: OpeningNode, question: QuestionNode, endings: EndingsNode }
const MAX_QUESTIONS = 12

type Props = Omit<FlowEditor, 'reveal' | 'routedOptions'> & { selectedKey: string | null }

/**
 * The Flow view: the conversation drawn as a map. Boxes are edited in place;
 * arrows come from the draft (flowGraph.ts) and cannot be drawn or deleted by
 * hand. Dragging moves a box and nothing else: order and conditions belong to
 * the draft and change only through named actions.
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
  const [moved, setMoved] = useState<Record<string, Point>>({})
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  const [fitted, setFitted] = useState(false)

  const structure = `${ids.join('|')}#${graph.edges.map((e) => e.id).join('|')}`
  const sizeKey = ids.map((id) => (sizes[id] ? `${Math.round(sizes[id].width)}x${Math.round(sizes[id].height)}` : '?')).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flowEdges = useMemo(() => graph.edges.map((e) => ({ ...e, source: nodeIdOf(e.source), target: nodeIdOf(e.target) })), [graph, nodeIdOf])
  const layout = useMemo(() => layoutFlow(ids, flowEdges, sizes), [structure, sizeKey])

  const nodes: Node[] = ids.map((id) => ({
    id,
    type: id === OPENING ? 'opening' : id === ENDINGS ? 'endings' : 'question',
    position: moved[id] ?? layout[id],
    data: { questionKey: keyOfNode(id), nodeId: id },
    selected: id === selectedKey,
    ...(sizes[id] ? { measured: sizes[id] } : {}),
  }))
  const centre = (id: string) => (moved[id] ?? layout[id]).x + (sizes[id]?.width ?? 300) / 2
  const side = (from: string, to: string) => (centre(to) > centre(from) ? 'r' : 'l')
  const edges: Edge[] = flowEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // An answer's route leaves from the side of the box that faces where it goes.
    sourceHandle: e.option ? `opt-${e.option}-${side(e.source, e.target)}` : 'next',
    targetHandle: 'in',
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: e.option ? { stroke: '#6366f1', strokeWidth: 1.75 } : { stroke: '#9ca3af', strokeWidth: 1.5 },
    focusable: false,
  }))

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const nextSizes: Record<string, Size> = {}
    const nextMoved: Record<string, Point> = {}
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) nextSizes[c.id] = c.dimensions
      if (c.type === 'position' && c.position) nextMoved[c.id] = c.position
    }
    if (Object.keys(nextSizes).length) {
      setSizes((s) => {
        const changed = Object.entries(nextSizes).some(([id, d]) => !s[id] || Math.abs(s[id].height - d.height) > 2 || Math.abs(s[id].width - d.width) > 2)
        return changed ? { ...s, ...nextSizes } : s
      })
    }
    if (Object.keys(nextMoved).length) setMoved((m) => ({ ...m, ...nextMoved }))
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

  // A box just created is brought into view once it exists and is measured.
  useEffect(() => {
    if (!pendingReveal || !sizes[pendingReveal]) return
    void flow.fitView({ nodes: [{ id: pendingReveal }], maxZoom: 1, duration: 300, padding: 0.4 })
    setPendingReveal(null)
  }, [pendingReveal, sizes, flow])

  const routedOptions = useMemo(() => new Set(graph.edges.filter((e) => e.option).map((e) => `${e.source}:${e.option}`)), [graph])
  const context: FlowEditor = { ...editor, reveal: setPendingReveal, routedOptions }
  const full = model.questions.length >= MAX_QUESTIONS

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
          nodesConnectable={false}
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
          <Panel position='top-right'>
            <div dir='rtl' className='flex items-center gap-2'>
              <AddQuestionMenu
                disabledReason={full ? 'אפשר עד 12 שאלות בשאלון.' : null}
                onAdd={(kind) => {
                  const ref = newRef()
                  edit((m) => addQuestion(m, kind, ref))
                  announce('נוספה שאלה חדשה לפני הסיום')
                  select(ref)
                  setPendingReveal(ref)
                }}
              />
              {Object.keys(moved).length > 0 && (
                <Btn type='button' variant='outline' lbl='סידור מחדש' onClick={() => setMoved({})} />
              )}
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </FlowEditorContext.Provider>
  )
}
