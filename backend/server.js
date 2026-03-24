const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

const { GraphStore } = require("./services/graphStore");
const { createGraphRoutes } = require("./routes/graph");
const { createChatRoutes } = require("./routes/chat");
const { createFlowRoutes } = require("./routes/flow");
const { guardQuestion } = require("./src/utils/guardrails");

// Always load backend/.env regardless of the process working directory.
// Use override so a stale process/user env var doesn't keep NEO4J_DISABLED stuck at "1".
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const PORT = Number.parseInt(process.env.PORT || "4000", 10);

async function main() {
  const graphStore = new GraphStore();
  await graphStore.load();
  // eslint-disable-next-line no-console
  console.log(
    `Graph built: nodes=${graphStore.nodesById.size.toLocaleString()} edges=${graphStore.edges.length.toLocaleString()}`
  );

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // Request logging (debug)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      // eslint-disable-next-line no-console
      console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true, loadedAt: graphStore.loadedAt }));

  app.use("/api", createGraphRoutes({ graphStore }));
  app.use("/api", createFlowRoutes({ graphStore }));
  app.use("/api", createChatRoutes({ graphStore, guardQuestion }));

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`Dataset loaded from: ${graphStore.dataDir}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
