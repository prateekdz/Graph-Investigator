import { useEffect, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

function nodePaint(node, ctx, { selected, hovered, highlighted, isHub, dim }) {
  const r = selected ? 6 : hovered ? 5.2 : isHub ? 4.6 : highlighted ? 4.2 : 3.2
  const fill = node.color

  const wasAlpha = ctx.globalAlpha
  if (dim && typeof ctx.globalAlpha === 'number') {
    ctx.globalAlpha = 0.28
  }

  if (selected || highlighted || hovered) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 9, 0, 2 * Math.PI, false)
    ctx.fillStyle = selected ? 'rgba(0, 0, 0, 0.10)' : 'rgba(0, 0, 0, 0.06)'
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false)
  ctx.fillStyle = fill
  ctx.fill()

  if (selected) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  ctx.globalAlpha = wasAlpha
}

export default function GraphStage({
  graph,
  selectedNodeId,
  highlightNodeIds,
  onSelect,
  onBackgroundClick,
  focusNodeId,
}) {
  const fgRef = useRef(null)
  const wrapRef = useRef(null)
  const [hoverLink, setHoverLink] = useState(null)
  const [hoverNodeId, setHoverNodeId] = useState(null)

  const selectedId = selectedNodeId || null

  useEffect(() => {
    const id = focusNodeId
    if (!id || !fgRef.current) return
    let tries = 0
    const tick = () => {
      tries += 1
      const node = graph.nodes.find((n) => n.id === id)
      if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
        fgRef.current.centerAt(node.x, node.y, 650)
        fgRef.current.zoom(3.0, 750)
        return
      }
      if (tries < 40) requestAnimationFrame(tick)
    }
    tick()
  }, [focusNodeId, graph.nodes])

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full overflow-hidden bg-[#f9fafb]"
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={graph}
        backgroundColor="#f9fafb"
        cooldownTicks={120}
        d3VelocityDecay={0.25}
        d3AlphaDecay={0.02}
        enableNodeDrag={true}
        nodeLabel={(n) => n.label || n.id}
        linkColor={(l) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source
          const tgt = typeof l.target === 'object' ? l.target.id : l.target
          if (hoverLink && l === hoverLink) return 'rgba(203, 213, 225, 0.95)'
          if (selectedId && (src === selectedId || tgt === selectedId)) return 'rgba(203, 213, 225, 0.70)'
          if (selectedId && highlightNodeIds?.has?.(src) && highlightNodeIds?.has?.(tgt)) return 'rgba(203, 213, 225, 0.40)'
          if (selectedId) return 'rgba(203, 213, 225, 0.16)'
          return 'rgba(203, 213, 225, 0.28)'
        }}
        linkWidth={(l) => {
          if (hoverLink && l === hoverLink) return 1.6
          const src = typeof l.source === 'object' ? l.source.id : l.source
          const tgt = typeof l.target === 'object' ? l.target.id : l.target
          if (selectedId && (src === selectedId || tgt === selectedId)) return 1.2
          if (selectedId && highlightNodeIds?.has?.(src) && highlightNodeIds?.has?.(tgt)) return 0.9
          return 0.6
        }}
        linkHoverPrecision={8}
        onLinkHover={(l) => setHoverLink(l || null)}
        onNodeHover={(n) => setHoverNodeId(n?.id || null)}
        nodeCanvasObject={(node, ctx) => {
          const isHub = Boolean(node.isHub)
          const hovered = hoverNodeId === node.id
          const highlighted = highlightNodeIds?.has?.(node.id) || false
          const selected = node.id === selectedId
          const dim = Boolean(selectedId && !selected && !highlighted && !hovered)
          nodePaint(node, ctx, { selected, hovered, highlighted, isHub, dim })
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI, false)
          ctx.fill()
        }}
        onNodeClick={(node) => {
          if (!fgRef.current) return
          const screen = fgRef.current.graph2ScreenCoords(node.x, node.y)
          const rect = wrapRef.current?.getBoundingClientRect?.() || null
          onSelect?.(node, screen, rect)
        }}
        onBackgroundClick={() => onBackgroundClick?.()}
        nodeColor={(n) => n.color}
      />

    </div>
  )
}
