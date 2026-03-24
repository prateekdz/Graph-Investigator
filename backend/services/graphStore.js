const { buildGraphFromDataDir, defaultDataDir, resolveDataDir } = require("./graphBuilder");

class GraphStore {
  constructor() {
    this.nodesById = new Map();
    this.nodesByType = new Map();
    this.edges = [];
    this.adj = new Map(); // id -> Set(neighborId)
    this.loadedAt = null;
    this.dataDir = process.env.DATA_DIR || defaultDataDir();
  }

  async load() {
    this.dataDir = resolveDataDir(this.dataDir);
    const { nodes, edges } = await buildGraphFromDataDir(this.dataDir);
    this.nodesById.clear();
    this.nodesByType.clear();
    this.adj.clear();
    this.edges = edges;

    for (const n of nodes) {
      this.nodesById.set(n.id, n);
      if (!this.nodesByType.has(n.type)) this.nodesByType.set(n.type, []);
      this.nodesByType.get(n.type).push(n);
      this.adj.set(n.id, new Set());
    }
    for (const e of edges) {
      if (this.adj.has(e.source)) this.adj.get(e.source).add(e.target);
      if (this.adj.has(e.target)) this.adj.get(e.target).add(e.source);
    }
    this.loadedAt = new Date().toISOString();
  }

  snapshot() {
    return {
      loadedAt: this.loadedAt,
      nodes: Array.from(this.nodesById.values()),
      edges: this.edges
    };
  }

  entitiesByType(type) {
    return this.nodesByType.get(type) || [];
  }

  entityById(id) {
    const node = this.nodesById.get(id) || null;
    if (!node) return null;
    const neighbors = Array.from(this.adj.get(id) || [])
      .map((nid) => this.nodesById.get(nid))
      .filter(Boolean);
    const incidentEdges = this.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => ({ ...e, direction: e.source === id ? "out" : "in" }));
    return { node, neighbors, edges: incidentEdges };
  }

  findByToken(token) {
    const t = String(token || "").trim();
    if (!t) return [];
    const results = [];
    for (const n of this.nodesById.values()) {
      if (n.id.includes(t)) results.push(n);
      else {
        const text = JSON.stringify(n.fields);
        if (text.includes(t)) results.push(n);
      }
    }
    return results.slice(0, 20);
  }

  subgraphAround(nodeIds, hops = 2, maxNodes = 200) {
    const queue = [];
    const seen = new Set();
    for (const id of nodeIds) {
      if (this.nodesById.has(id)) {
        queue.push({ id, depth: 0 });
        seen.add(id);
      }
    }

    while (queue.length > 0 && seen.size < maxNodes) {
      const { id, depth } = queue.shift();
      if (depth >= hops) continue;
      for (const nb of this.adj.get(id) || []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push({ id: nb, depth: depth + 1 });
        if (seen.size >= maxNodes) break;
      }
    }

    const nodes = Array.from(seen).map((id) => this.nodesById.get(id)).filter(Boolean);
    const nodeSet = new Set(seen);
    const edges = this.edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));
    return { nodes, edges };
  }
}

module.exports = { GraphStore };
