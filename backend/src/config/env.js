const dotenv = require("dotenv");
const path = require("path");

// Always load backend/.env regardless of the process working directory.
// Use override so a stale process/user env var doesn't keep NEO4J_DISABLED stuck at "1".
dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });

function getEnv(name, { required = true, defaultValue } = {}) {
  const value = process.env[name] ?? defaultValue;
  if (required && (value === undefined || value === "")) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  port: toInt(getEnv("PORT", { required: false, defaultValue: "4000" }), 4000),
  dbKind: (process.env.DB_KIND || "neo4j").toLowerCase(),
  neo4j: {
    enabled: !["1", "true", "yes"].includes(String(process.env.NEO4J_DISABLED || "").toLowerCase()),
    uri: getEnv("NEO4J_URI", { required: false, defaultValue: "bolt://localhost:7687" }),
    user: getEnv("NEO4J_USER", { required: false, defaultValue: "neo4j" }),
    password: getEnv("NEO4J_PASSWORD", { required: false, defaultValue: "please-change" }),
    database: getEnv("NEO4J_DATABASE", { required: false, defaultValue: "neo4j" })
  },
  querySafety: {
    maxLimit: toInt(getEnv("QUERY_MAX_LIMIT", { required: false, defaultValue: "500" }), 500),
    timeoutMs: toInt(getEnv("QUERY_TIMEOUT_MS", { required: false, defaultValue: "8000" }), 8000)
  }
};

module.exports = { env };
