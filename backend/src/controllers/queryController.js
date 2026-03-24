const { executeReadOnlyCypher } = require("../services/queryService");
const { ask } = require("../services/llmService");

async function executeQuery(req, res, next) {
  try {
    const { query, params, limit } = req.body || {};
    const result = await executeReadOnlyCypher({ query, params, limit });
    return res.json({
      limit: result.limit,
      records: result.records.map((r) => r.toObject())
    });
  } catch (err) {
    return next(err);
  }
}

async function askLlm(req, res, next) {
  try {
    const { question } = req.body || {};
    const result = await ask({ question });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { executeQuery, askLlm };

