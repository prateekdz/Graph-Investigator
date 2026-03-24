const MAX_LABEL_LEN = 38

function isObject(x) {
  return x && typeof x === 'object'
}

function truncate(s, n = MAX_LABEL_LEN) {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function isNeo4jNode(x) {
  return isObject(x) && Array.isArray(x.labels) && isObject(x.properties)
}

function isNeo4jRel(x) {
  return isObject(x) && typeof x.type === 'string' && isObject(x.properties)
}

function nodeKeyFromNeo4j(node) {
  const props = node.properties || {}
  const entityType = props.entityType || node.labels?.[0] || 'Entity'
  const entityId =
    props.entityId ||
    props.businessPartner ||
    props.customer ||
    props.salesOrder ||
    props.billingDocument ||
    props.deliveryDocument ||
    props.product ||
    props.addressUuid
  if (!entityId) return null
  return { entityType, entityId: String(entityId), id: `${entityType}:${String(entityId)}` }
}

function displayLabel(node) {
  const props = node.properties || {}
  const name = props.name || props.description || props.productOldId || null
  const entityType = props.entityType || node.labels?.[0] || 'Entity'
  const entityId =
    props.entityId ||
    props.customer ||
    props.businessPartner ||
    props.salesOrder ||
    props.billingDocument ||
    props.deliveryDocument ||
    props.product ||
    props.addressUuid ||
    ''
  if (name) return truncate(`${entityType}: ${name}`)
  return truncate(`${entityType}: ${entityId}`)
}

function nodeColor(entityType) {
  switch (entityType) {
    case 'Customer':
      return '#2563eb'
    case 'Order':
    case 'OrderLine':
      return '#0ea5e9'
    case 'Delivery':
    case 'DeliveryLine':
      return '#22c55e'
    case 'Invoice':
    case 'InvoiceLine':
      return '#f97316'
    case 'Payment':
      return '#a855f7'
    case 'Address':
      return '#64748b'
    case 'Product':
      return '#14b8a6'
    default:
      return '#334155'
  }
}

function toNode(node) {
  const key = nodeKeyFromNeo4j(node)
  if (!key) return null
  return {
    ...key,
    label: displayLabel(node),
    color: nodeColor(key.entityType),
    properties: node.properties || {},
    labels: node.labels || [],
    elementId: node.elementId ?? null,
    identity: node.identity ?? null,
  }
}

function relEndpoints(rel) {
  const start = rel.startNodeElementId ?? rel.start ?? null
  const end = rel.endNodeElementId ?? rel.end ?? null
  return { start, end }
}

function walk(value, ctx) {
  const { nodes, links, elementToNodeId, pendingRels } = ctx
  if (Array.isArray(value)) {
    for (const v of value) walk(v, ctx)
    return
  }
  if (!isObject(value)) return

  if (isNeo4jNode(value)) {
    const n = toNode(value)
    if (n) {
      nodes.push(n)
      if (n.elementId) elementToNodeId.set(String(n.elementId), n.id)
      if (n.identity !== null && n.identity !== undefined) elementToNodeId.set(String(n.identity), n.id)
    }
    return
  }

  if (isNeo4jRel(value)) {
    const { start, end } = relEndpoints(value)
    if (start && end) {
      const from = elementToNodeId.get(String(start))
      const to = elementToNodeId.get(String(end))
      if (from && to) {
        links.push({ id: `${from}->${to}:${value.type}`, source: from, target: to, type: value.type })
      } else {
        pendingRels.push({ start: String(start), end: String(end), type: value.type })
      }
    }
    return
  }

  if (Array.isArray(value.segments)) {
    for (const seg of value.segments) {
      const startNode = seg?.start && isNeo4jNode(seg.start) ? toNode(seg.start) : null
      const endNode = seg?.end && isNeo4jNode(seg.end) ? toNode(seg.end) : null

      if (startNode) {
        nodes.push(startNode)
        if (startNode.elementId) elementToNodeId.set(String(startNode.elementId), startNode.id)
        if (startNode.identity !== null && startNode.identity !== undefined)
          elementToNodeId.set(String(startNode.identity), startNode.id)
      }
      if (endNode) {
        nodes.push(endNode)
        if (endNode.elementId) elementToNodeId.set(String(endNode.elementId), endNode.id)
        if (endNode.identity !== null && endNode.identity !== undefined)
          elementToNodeId.set(String(endNode.identity), endNode.id)
      }

      const relType = seg?.relationship?.type
      if (startNode && endNode && relType) {
        const linkId = `${startNode.id}->${endNode.id}:${relType}`
        links.push({ id: linkId, source: startNode.id, target: endNode.id, type: relType })
      } else if (seg?.relationship) {
        walk(seg.relationship, ctx)
      }
    }
    return
  }

  for (const v of Object.values(value)) walk(v, ctx)
}

function normalizeGraphLike(payload) {
  const nodes = []
  const links = []
  const elementToNodeId = new Map()
  const pendingRels = []

  walk(payload, { nodes, links, elementToNodeId, pendingRels })

  // Resolve relationships that referenced elementIds/identities we saw later.
  for (const r of pendingRels) {
    const from = elementToNodeId.get(String(r.start))
    const to = elementToNodeId.get(String(r.end))
    if (!from || !to) continue
    links.push({ id: `${from}->${to}:${r.type}`, source: from, target: to, type: r.type })
  }

  // De-dup
  const nodeMap = new Map()
  for (const n of nodes) nodeMap.set(n.id, n)
  const linkMap = new Map()
  for (const l of links) linkMap.set(l.id, l)
  return { nodes: Array.from(nodeMap.values()), links: Array.from(linkMap.values()) }
}

export function normalizeRecordsPayload(records) {
  return normalizeGraphLike(records)
}

export function normalizeConnectionsPayload(payload) {
  return normalizeGraphLike(payload)
}

export function mergeGraph(a, b) {
  const nodeMap = new Map()
  for (const n of a.nodes) nodeMap.set(n.id, n)
  for (const n of b.nodes) {
    const prev = nodeMap.get(n.id)
    nodeMap.set(n.id, prev ? { ...prev, ...n, properties: { ...prev.properties, ...n.properties } } : n)
  }

  const linkMap = new Map()
  for (const l of a.links) linkMap.set(l.id, l)
  for (const l of b.links) linkMap.set(l.id, l)

  return { nodes: Array.from(nodeMap.values()), links: Array.from(linkMap.values()) }
}
