const { getNodeConnections } = require("../services/graphService");

async function getConnections(req, res, next) {
  try {
    const { entityType, entityId } = req.params;
    const { depth, limit } = req.query;
    const data = await getNodeConnections({ entityType, entityId, depth, limit });
    if (!data) return res.status(404).json({ error: "Node not found." });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getConnections };

