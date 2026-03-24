const { graphSchema } = require("./schema");

const FORBIDDEN = [
  "create",
  "merge",
  "set",
  "delete",
  "detach delete",
  "remove",
  "drop",
  "call",
  "load csv",
  "apoc."
];

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function findTokens(query) {
  // Extract all :Tokens (labels and relationship types).
  // This is conservative: if it sees a token not in the allowed union, reject.
  const tokens = new Set();
  const re = /:([A-Za-z_][A-Za-z0-9_]*)/g;
  const s = String(query || "");
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(s))) {
    tokens.add(match[1]);
  }
  return Array.from(tokens);
}

function validateCypherDatasetOnly(query) {
  const q = normalizeWhitespace(query);
  const lower = q.toLowerCase();

  if (!/\breturn\b/i.test(q)) {
    const err = new Error("Rejected: Cypher must include RETURN.");
    err.statusCode = 400;
    throw err;
  }

  if (FORBIDDEN.some((kw) => lower.includes(kw))) {
    const err = new Error("Rejected: forbidden Cypher keyword present.");
    err.statusCode = 400;
    throw err;
  }

  const allowed = new Set([...graphSchema.labels, ...graphSchema.relationshipTypes]);
  const tokens = findTokens(q);
  const unknown = tokens.filter((t) => !allowed.has(t));
  if (unknown.length > 0) {
    const err = new Error(`Rejected: unknown label/relationship type(s): ${unknown.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
}

module.exports = { validateCypherDatasetOnly };

