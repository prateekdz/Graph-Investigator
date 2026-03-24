const express = require("express");
const { executeReadOnlyCypher } = require("../services/queryService");

const router = express.Router();

router.post("/execute", async (req, res, next) => {
  try {
    const { query, params, limit } = req.body || {};
    const result = await executeReadOnlyCypher({ query, params, limit });

    // Return a JSON-friendly shape (neo4j types are already plain with disableLosslessIntegers).
    res.json({
      limit: result.limit,
      records: result.records.map((r) => r.toObject())
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };

