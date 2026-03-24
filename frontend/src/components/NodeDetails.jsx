import { useMemo } from 'react'
import './NodeDetails.css'

function degree(graph, nodeId) {
  if (!nodeId) return 0
  let d = 0
  for (const l of graph.links) if (l.source === nodeId || l.target === nodeId) d += 1
  return d
}

function renderValue(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function NodeDetails({ node, graph, onExpand, onClose }) {
  const show = Boolean(node)

  const rows = useMemo(() => {
    if (!node?.properties) return []
    return Object.entries(node.properties)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 16)
  }, [node])

  if (!show) return null

  return (
    <div className="nodeCard">
      <div className="nodeCardHeader">
        <div>
          <div className="nodeTitle">{node.entityType}</div>
          <div className="nodeSub">entityId: {node.entityId}</div>
        </div>
        <button className="iconBtn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="nodeMeta">
        <div className="pill">{degree(graph, node.id)} connections</div>
        <div className="pill">{node.labels?.[0] || node.entityType}</div>
      </div>

      <div className="nodeRows">
        {rows.map(([k, v]) => (
          <div key={k} className="row">
            <div className="k">{k}</div>
            <div className="v">{renderValue(v)}</div>
          </div>
        ))}
      </div>

      <div className="nodeActions">
        <button className="btn" onClick={onExpand}>
          Load connections
        </button>
      </div>
    </div>
  )
}

