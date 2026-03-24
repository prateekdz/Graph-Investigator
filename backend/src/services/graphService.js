const { runCypher } = require("../db/neo4j");
const { env } = require("../config/env");

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function getNodeConnections({ entityType, entityId, depth, limit }) {
  const effectiveDepth = clampInt(depth, { min: 1, max: 3, fallback: 1 });
  const effectiveLimit = clampInt(limit, { min: 1, max: 1000, fallback: 200 });

  // Assumes nodes have {entityType, entityId} properties for consistent addressing.
  const query = `
MATCH (n { entityType: $entityType, entityId: $entityId })
CALL {
  WITH n
  MATCH p=(n)-[*1..${effectiveDepth}]-(m)
  RETURN p
  LIMIT $limit
}
RETURN n, collect(p) AS paths
`;

  const result = await runCypher({
    query,
    params: { entityType, entityId, limit: effectiveLimit },
    timeoutMs: env.querySafety.timeoutMs
  });

  const record = result.records[0];
  if (!record) return null;

  return {
    node: record.get("n"),
    paths: record.get("paths")
  };
}

module.exports = { getNodeConnections };

