const { classifyDatasetQuestion, buildFallbackResponse } = require("../services/llm/domainGuard");
const { buildSafeCypher } = require("../services/llmGuard");
const { validateCypherDatasetOnly } = require("../services/llm/cypherPolicy");
const { validateSqlDatasetOnly, ensureLimit } = require("../services/llm/sqlPolicy");

function guardQuestion(question) {
  const guard = classifyDatasetQuestion(question);
  if (guard.allowed) return { allowed: true };
  return { allowed: false, reason: guard.reason, message: buildFallbackResponse(guard) };
}

function guardCypher(query) {
  validateCypherDatasetOnly(query);
  return buildSafeCypher({ query });
}

function guardSql(sql, maxLimit) {
  validateSqlDatasetOnly(sql);
  return { query: ensureLimit(sql, maxLimit) };
}

module.exports = { guardQuestion, guardCypher, guardSql };

