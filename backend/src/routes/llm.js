const express = require("express");
const { ask } = require("../services/llm/llmService");

const router = express.Router();

// POST /llm/ask
// Body: { "question": "..." }
router.post("/ask", async (req, res, next) => {
  try {
    const { question } = req.body || {};
    const result = await ask({ question });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = { router };

