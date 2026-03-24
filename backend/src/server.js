const { createApp } = require("./app");
const { env } = require("./config/env");
const { closeDriver } = require("./db/neo4j");

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${env.port}`);
});

async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`Shutting down (${signal})...`);
  server.close(async () => {
    try {
      await closeDriver();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

