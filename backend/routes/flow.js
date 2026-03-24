const express = require("express");
const { buildFlow } = require("../services/flowService");

function createFlowRoutes({ graphStore }) {
  const router = express.Router();

  // GET /api/flow/:id
  // Accepts either full node id (e.g. "SalesOrder:740506") or a raw business id (e.g. "740506").
  router.get("/flow/:id", async (req, res, next) => {
    try {
      const rawId = req.params.id;
      const { found, flow, meta } = buildFlow({ graphStore, rawId });
      if (!found || !flow) return res.status(404).json({ error: "Not found", meta });
      return res.json(flow);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createFlowRoutes };

