const { llmComplete } = require("./providers");
const { extractJsonObject } = require("./json");
const { buildQueryPrompt, buildSqlQueryPrompt, buildAnswerPrompt } = require("./promptTemplates");
const { buildSafeCypher } = require("../llmGuard");
const { validateCypherDatasetOnly } = require("./cypherPolicy");
const { executeReadOnlyCypher } = require("../queryService");
const { env } = require("../../config/env");
const { validateSqlDatasetOnly, ensureLimit } = require("./sqlPolicy");
const { runSql } = require("../../db/postgres");
const { classifyDatasetQuestion, buildFallbackResponse } = require("./domainGuard");

async function generateQueryFromQuestion({ question }) {
  const messages = env.dbKind === "postgres" ? buildSqlQueryPrompt({ question }) : buildQueryPrompt({ question });
  let raw;
  let parsed;
  try {
    raw = await llmComplete({ messages, temperature: 0 });
    parsed = extractJsonObject(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[llm] generateQueryFromQuestion failed:", err?.message || err);
    const e = new Error(
      `LLM provider failed while generating a query. ${process.env.LLM_PROVIDER ? `LLM_PROVIDER=${process.env.LLM_PROVIDER}. ` : ""}` +
        `Details: ${err?.message || String(err)}`
    );
    e.statusCode = 502;
    throw e;
  }

  if (parsed?.needs_clarification) {
    return {
      needsClarification: true,
      clarificationQuestion: parsed?.clarification_question || "Can you clarify what you want to filter/group by?"
    };
  }

  const query = parsed?.query;

  if (env.dbKind === "postgres") {
    if (parsed?.language !== "sql") {
      const err = new Error("LLM returned an unsupported language. Expected sql.");
      err.statusCode = 502;
      throw err;
    }
    const params = Array.isArray(parsed?.params) ? parsed.params : [];
    validateSqlDatasetOnly(query);
    const limited = ensureLimit(query, env.querySafety.maxLimit);
    return { needsClarification: false, language: "sql", query: limited, params };
  }

  if (parsed?.language !== "cypher") {
    const err = new Error("LLM returned an unsupported language. Expected cypher.");
    err.statusCode = 502;
    throw err;
  }

  const params = parsed?.params || {};
  validateCypherDatasetOnly(query);
  const safe = buildSafeCypher({ query, requestedLimit: undefined });
  return { needsClarification: false, language: "cypher", query: safe.query, params, timeoutMs: safe.timeoutMs };
}

async function answerQuestionWithResults({ question, cypher, params, records }) {
  const messages = buildAnswerPrompt({ question, query: cypher, params, records });
  try {
    const raw = await llmComplete({ messages, temperature: 0.2 });
    return String(raw).trim();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[llm] answerQuestionWithResults failed:", err?.message || err);
    return (
      "I executed the query but the LLM failed to generate a natural-language answer. " +
      `Error: ${err?.message || String(err)}`
    );
  }
}

async function ask({ question }) {
  const guard = classifyDatasetQuestion(question);
  if (!guard.allowed) {
    return {
      rejected: true,
      reason: guard.reason,
      message: buildFallbackResponse(guard)
    };
  }

  const q = String(question || "").trim();

  const plan = await generateQueryFromQuestion({ question: q });
  if (plan.needsClarification) {
    return { needsClarification: true, clarificationQuestion: plan.clarificationQuestion };
  }

  let records;
  let executedQueryLabel;
  let executedQuery;
  let executedParams;

  if (plan.language === "sql") {
    const res = await runSql({ text: plan.query, values: plan.params });
    records = res.rows;
    executedQueryLabel = "sql";
    executedQuery = plan.query;
    executedParams = plan.params;
  } else {
    const exec = await executeReadOnlyCypher({ query: plan.query, params: plan.params });
    records = exec.records.map((r) => r.toObject());
    executedQueryLabel = "cypher";
    executedQuery = plan.query;
    executedParams = plan.params;
  }

  const answer = await answerQuestionWithResults({
    question: q,
    cypher: executedQuery,
    params: executedParams,
    records
  });

  return {
    needsClarification: false,
    language: executedQueryLabel,
    query: executedQuery,
    params: executedParams,
    records,
    answer
  };
}

module.exports = { ask };
