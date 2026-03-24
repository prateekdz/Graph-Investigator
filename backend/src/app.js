const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");

const { router: healthRouter } = require("./routes/health");
const { router: graphRouter } = require("./routes/graphRoutes");
const { router: queryRouter } = require("./routes/queryRoutes");
const { router: apiRouter } = require("./routes/apiRoutes");

function createApp() {
  const app = express();

  const rawOrigins = String(process.env.CORS_ORIGIN || "").trim();
  if (!rawOrigins || rawOrigins === "*") {
    app.use(cors({ origin: true }));
  } else {
    const allowed = rawOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    app.use(
      cors({
        origin(origin, cb) {
          if (!origin) return cb(null, true);
          return cb(null, allowed.includes(origin));
        }
      })
    );
  }
  app.use(express.json({ limit: "1mb" }));

  // Request logging (debug)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      // eslint-disable-next-line no-console
      console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.use("/health", healthRouter);

  if (env.dbKind !== "neo4j") {
    app.use((req, res) => res.status(501).json({ error: `DB_KIND=${env.dbKind} not implemented. Use neo4j.` }));
    return app;
  }

  // SaaS app API (used by the frontend)
  app.use("/api", apiRouter);

  app.use("/graph", graphRouter);
  app.use("/query", queryRouter);
  // Back-compat: keep /llm/ask working by mounting queryRoutes at /llm too.
  app.use("/llm", queryRouter);

  // Basic error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || "Internal Server Error" });
  });

  return app;
}

module.exports = { createApp };
