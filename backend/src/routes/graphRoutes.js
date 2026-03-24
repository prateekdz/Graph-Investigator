const express = require("express");
const { getConnections } = require("../controllers/graphController");

const router = express.Router();

router.get("/nodes/:entityType/:entityId/connections", getConnections);

module.exports = { router };

