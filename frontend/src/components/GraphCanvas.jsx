import { useMemo, useState } from 'react'
import FloatingActions from './FloatingActions'
import GraphStage from './GraphStage'
import DetailCard from './DetailCard'

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function computeCardPosition({ anchor, container, card }) {
  if (!anchor || !container) return { left: 0, top: 0, visible: false }

  const preferred = {
    left: anchor.x + 16,
    top: anchor.y - 22,
  }

  const left = clamp(preferred.left, 16, container.width - card.width - 16)
  const top = clamp(preferred.top, 16, container.height - card.height - 16)

  return { left, top, visible: true }
}

export default function GraphCanvas({
  graph,
  minimized,
  overlayHidden,
  selectedNodeId,
  highlightNodeIds,
  focusNodeId,
  details,
  cardOpen,
  onCloseCard,
  onToggleMinimize,
  onToggleOverlay,
  onSelectNode,
  onClearSelection,
  loading,
  error,
}) {
  const [anchor, setAnchor] = useState(null)
  const [container, setContainer] = useState(null)

  const pos = useMemo(
    () =>
      computeCardPosition({
        anchor,
        container,
        card: { width: 320, height: 480 },
      }),
    [anchor, container],
  )

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#f9fafb]">
      <FloatingActions
        minimized={minimized}
        overlayHidden={overlayHidden}
        onToggleMinimize={onToggleMinimize}
        onToggleOverlay={onToggleOverlay}
      />

      {minimized ? (
        <div className="h-full grid place-items-center text-slate-500 text-sm">Minimized</div>
      ) : (
        <GraphStage
          graph={graph}
          selectedNodeId={selectedNodeId}
          highlightNodeIds={highlightNodeIds}
          focusNodeId={focusNodeId}
          onSelect={(node, screen, rect) => {
            onSelectNode?.(node)
            if (screen && rect) {
              setContainer({ width: rect.width, height: rect.height })
              setAnchor({ x: screen.x, y: screen.y })
            }
          }}
          onBackgroundClick={() => {
            setAnchor(null)
            onClearSelection?.()
          }}
        />
      )}

      {cardOpen && details?.node ? (
        <div
          className="absolute z-20"
          style={pos.visible ? { left: pos.left, top: pos.top } : { left: 16, top: 16 }}
        >
          <DetailCard details={details} onClose={onCloseCard} />
        </div>
      ) : null}

      {loading ? (
        <div className="absolute left-4 bottom-4 px-3 py-2 rounded-xl border border-gray-200 bg-white/90 text-gray-700 text-xs shadow-sm">
          Loading graph…
        </div>
      ) : null}
      {error ? (
        <div className="absolute left-4 bottom-4 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs shadow-sm">
          {error}
        </div>
      ) : null}
    </div>
  )
}
