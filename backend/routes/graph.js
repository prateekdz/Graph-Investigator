const express = require("express");
const { search } = require("../services/searchService");
const { guardQuestion } = require("../src/utils/guardrails");

function createGraphRoutes({ graphStore }) {
  const router = express.Router();

  // GET /api/graph
  // Returns { nodes: [...], links: [...] } for react-force-graph.
  router.get("/graph", async (req, res, next) => {
    try {
      const snap = graphStore.snapshot();
      return res.json({
        loadedAt: snap.loadedAt,
        nodes: snap.nodes,
        links: (snap.edges || []).map((e, i) => ({
          id: `${e.source}->${e.target}:${e.relationship}:${i}`,
          source: e.source,
          target: e.target,
          relationship: e.relationship
        }))
      });
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/graph-data
  router.get("/graph-data", async (req, res, next) => {
    try {
      return res.json(graphStore.snapshot());
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/entities/:type
  router.get("/entities/:type", async (req, res, next) => {
    try {
      const { type } = req.params;
      return res.json({ type, nodes: graphStore.entitiesByType(type) });
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/entity/:id
  router.get("/entity/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = graphStore.entityById(id);
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/node/:id (alias for /api/entity/:id)
  router.get("/node/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = graphStore.entityById(id);
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/search?q=
  router.get("/search", async (req, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const result = await search({ q, graphStore, guardQuestion });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createGraphRoutes };
