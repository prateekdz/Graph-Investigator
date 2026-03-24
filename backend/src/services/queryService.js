const { runCypher } = require("../db/neo4j");
const { buildSafeCypher } = require("./llmGuard");

async function executeReadOnlyCypher({ query, params, limit }) {
  const safe = buildSafeCypher({ query, requestedLimit: limit });
  const result = await runCypher({ query: safe.query, params: params || {}, timeoutMs: safe.timeoutMs });
  return { records: result.records, limit: safe.limit };
}

module.exports = { executeReadOnlyCypher };

