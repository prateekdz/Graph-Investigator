const { env } = require("../../config/env");
const { schemaForPrompt } = require("./schema");
const { DATASET_TABLES } = require("./sqlPolicy");

function buildQueryPrompt({ question }) {
  const schema = schemaForPrompt();
  return [
    {
      role: "system",
      content:
        "You translate natural language into a SINGLE read-only Cypher query for Neo4j.\n" +
        "Rules:\n" +
        "- ONLY answer questions about the provided Order-to-Cash dataset. If the user asks anything else, set needs_clarification=true and ask them to restate the question about customers/orders/deliveries/invoices/payments/products/addresses.\n" +
        `- Use ONLY these labels: ${schema.labels.join(", ")}\n` +
        `- Use ONLY these relationship types: ${schema.relationships.join(", ")}\n` +
        "- Do NOT use write operations (CREATE/MERGE/SET/DELETE/REMOVE/DROP) or CALL/APOC/LOAD CSV.\n" +
        "- Always return a result table (RETURN ...).\n" +
        `- Always include LIMIT (<= ${env.querySafety.maxLimit}).\n` +
        "- Prefer matching by `entityId` when filtering a specific entity.\n" +
        "- If the question is ambiguous or cannot be answered from the schema, set needs_clarification=true and ask ONE clarification question.\n" +
        "\nOutput JSON ONLY with this exact shape:\n" +
        "{\n" +
        '  "language": "cypher",\n' +
        '  "needs_clarification": false,\n' +
        '  "clarification_question": null,\n' +
        '  "query": "MATCH ... RETURN ... LIMIT 50",\n' +
        '  "params": { }\n' +
        "}\n"
    },
    {
      role: "user",
      content:
        "Question:\n" +
        question +
        "\n\nNode id conventions (entityId):\n" +
        JSON.stringify(schema.nodeIdConventions, null, 2)
    }
  ];
}

function buildSqlQueryPrompt({ question }) {
  return [
    {
      role: "system",
      content:
        "You translate natural language into a SINGLE read-only SQL query for PostgreSQL.\n" +
        "Rules:\n" +
        "- ONLY answer questions about the provided Order-to-Cash dataset. If the user asks anything else, set needs_clarification=true and ask them to restate the question using dataset tables.\n" +
        `- Use ONLY these tables: ${DATASET_TABLES.join(", ")}\n` +
        "- Only SELECT queries are allowed (WITH ... SELECT is ok).\n" +
        "- Do NOT use INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/TRUNCATE/COPY/CALL.\n" +
        `- Always include LIMIT (<= ${env.querySafety.maxLimit}).\n` +
        "- If the question is ambiguous or cannot be answered from the tables, set needs_clarification=true and ask ONE clarification question.\n" +
        "\nOutput JSON ONLY with this exact shape:\n" +
        "{\n" +
        '  "language": "sql",\n' +
        '  "needs_clarification": false,\n' +
        '  "clarification_question": null,\n' +
        '  "query": "SELECT ... LIMIT 50",\n' +
        '  "params": []\n' +
        "}\n"
    },
    { role: "user", content: `Question:\n${question}` }
  ];
}

function buildAnswerPrompt({ question, query, params, records, maxRows = 50 }) {
  const safeRecords = records.slice(0, maxRows);
  return [
    {
      role: "system",
      content:
        "You answer business questions using ONLY the provided query results.\n" +
        "Rules:\n" +
        "- Do not invent entities, totals, or facts not present in results.\n" +
        "- If results are empty, say you couldn't find an answer from the data.\n" +
        "- Keep the answer concise and directly actionable.\n" +
        "- Use a structured format with a short title and bullet points.\n" +
        "- Bold important IDs and numbers using **like this**.\n" +
        "- If the question implies relationships (linked/connected/clears/applied), explain the relationship in one sentence.\n"
    },
    {
      role: "user",
      content:
        "Question:\n" +
        question +
        "\n\nExecuted Query:\n" +
        query +
        "\n\nParams:\n" +
        JSON.stringify(params || {}, null, 2) +
        "\n\nResults (JSON):\n" +
        JSON.stringify(safeRecords, null, 2)
    }
  ];
}

module.exports = { buildQueryPrompt, buildSqlQueryPrompt, buildAnswerPrompt };
