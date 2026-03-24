import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout'
import HeaderOverlay from '../components/HeaderOverlay'
import GraphCanvas from '../components/GraphCanvas'
import ChatPanel from '../components/ChatPanel'
import { API_BASE } from '../api/base'

export default function OrderToCash() {
  const [graph, setGraph] = useState({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hideSecondary, setHideSecondary] = useState(false)
  const [minimized, setMinimized] = useState(false)

  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [focusNodeId, setFocusNodeId] = useState(null)
  const [highlightNodeIds, setHighlightNodeIds] = useState(() => new Set())
  const [details, setDetails] = useState(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [chatInsight, setChatInsight] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const resp = await fetch(`${API_BASE}/graph`)
        if (!resp.ok) throw new Error(`graph failed (${resp.status})`)
        const data = await resp.json()
        if (cancelled) return

        const nodes = (data.nodes || []).map((n) => ({
          id: n.id,
          entityType: n.type,
          color: n.color || (n.primary ? '#60a5fa' : '#f87171'),
          isHub: (n.connections || 0) >= 25,
          fields: n.fields || {},
          label: n.label,
        }))
        const links = (data.links || []).map((l) => ({
          id: l.id || `${l.source}->${l.target}:${l.relationship}`,
          source: l.source,
          target: l.target,
          relationship: l.relationship,
        }))
        setGraph({ nodes, links })
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredGraph = useMemo(() => {
    if (!hideSecondary) return graph
    const keep = new Set(graph.nodes.filter((n) => n.color === '#60a5fa').map((n) => n.id))
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    }
  }, [graph, hideSecondary])

  async function fetchEntity(id) {
    const resp = await fetch(`${API_BASE}/node/${encodeURIComponent(id)}`)
    if (!resp.ok) throw new Error(`node fetch failed (${resp.status})`)
    const json = await resp.json()
    return json
  }

  async function selectNode(id) {
    setSelectedNodeId(id)
    setFocusNodeId(id)
    const d = await fetchEntity(id)
    setDetails(d)
    setCardOpen(true)
    setChatInsight({ key: `${id}:${Date.now()}`, node: d?.node || null, neighbors: d?.neighbors || [] })

    const hl = new Set([id])
    for (const n of d.neighbors || []) hl.add(n.id)
    setHighlightNodeIds(hl)
  }

  async function handleSearch(q) {
    setError('')
    const resp = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`)
    const json = await resp.json()
    if (json?.rejected) {
      setError(json.message || 'Rejected query')
      return json
    }
    if (!json?.found) {
      setError(json.message || 'No match found')
      return json
    }

    setDetails({ node: json.mainNode, neighbors: json.connections || [], edges: json.edges || [] })
    setCardOpen(true)
    setSelectedNodeId(json.mainNode.id)
    setFocusNodeId(json.mainNode.id)

    const hl = new Set()
    for (const n of json.subgraph?.nodes || []) hl.add(n.id)
    hl.add(json.mainNode.id)
    setHighlightNodeIds(hl)
    return json
  }

  async function handleChat(messages) {
    const lastUser = Array.isArray(messages) ? [...messages].reverse().find((m) => m?.role === 'user') : null
    const question = lastUser?.content || ''

    // Core feature: NL → query → execute (LLM) + highlight referenced nodes
    const resp = await fetch(`${API_BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })

    const json = await resp.json()

    if (json?.llmUnavailable) {
      setError(json.error || 'LLM not configured')
      return {
        response: json.answer || json.error || 'LLM not configured',
        suggestions: Array.isArray(json?.suggestions) ? json.suggestions : [],
        blocks: Array.isArray(json?.blocks) ? json.blocks : [],
      }
    }

    if (json?.rejected) {
      const msg = json.message || json.error || 'Rejected'
      setError(msg)
      return { response: msg, suggestions: [], blocks: [] }
    }

    if (json?.needsClarification) {
      return {
        response: json.clarificationQuestion || 'Can you clarify your question?',
        suggestions: [],
        blocks: [],
      }
    }

    const highlights = Array.isArray(json?.highlights) ? json.highlights : []
    let effectiveHighlights = highlights

    // Fallback: if backend didn't return highlights, extract ids from the answer and map to known graph nodes.
    if (!effectiveHighlights.length) {
      const answerText = String(json?.answer || '')
      const tokens = Array.from(answerText.matchAll(/\b\d{6,12}\b/g)).map((m) => m[0])
      if (tokens.length) {
        const byId = new Map(graph.nodes.map((n) => [n.id, n]))
        const found = []
        for (const t of tokens) {
          for (const id of byId.keys()) {
            if (id.endsWith(`:${t}`) || id.includes(`:${t}:`) || id.includes(t)) found.push(id)
          }
        }
        effectiveHighlights = Array.from(new Set(found)).slice(0, 50)
      }
    }

    if (effectiveHighlights.length) {
      setHighlightNodeIds(new Set(effectiveHighlights))
      setFocusNodeId(effectiveHighlights[0])
    }

    return {
      response: json.answer || 'No response.',
      suggestions: Array.isArray(json?.suggestions) ? json.suggestions : [],
      blocks: Array.isArray(json?.blocks) ? json.blocks : [],
      highlights: effectiveHighlights,
      query: json.query,
      language: json.language,
    }
  }

  return (
    <DashboardLayout
      header={<HeaderOverlay />}
      left={
        <GraphCanvas
          graph={filteredGraph}
          minimized={minimized}
          overlayHidden={hideSecondary}
          selectedNodeId={selectedNodeId}
          highlightNodeIds={highlightNodeIds}
          focusNodeId={focusNodeId}
          details={details}
          cardOpen={cardOpen}
          loading={loading}
          error={error}
          onCloseCard={() => setCardOpen(false)}
          onToggleMinimize={() => setMinimized((v) => !v)}
          onToggleOverlay={() => setHideSecondary((v) => !v)}
          onSelectNode={(node) => selectNode(node.id)}
          onClearSelection={() => {
            setSelectedNodeId(null)
            setDetails(null)
            setCardOpen(false)
            setHighlightNodeIds(new Set())
          }}
        />
      }
      right={<ChatPanel onSearch={handleSearch} onChat={handleChat} insight={chatInsight} onPickNodeId={(id) => id && selectNode(id)} />}
    />
  )
}
