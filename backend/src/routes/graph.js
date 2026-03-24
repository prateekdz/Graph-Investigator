const express = require("express");
const { getNodeConnections } = require("../services/graphService");

const router = express.Router();

router.get("/nodes/:entityType/:entityId/connections", async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const { depth, limit } = req.query;

    const data = await getNodeConnections({ entityType, entityId, depth, limit });
    if (!data) return res.status(404).json({ error: "Node not found." });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = { router };

