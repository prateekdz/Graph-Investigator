const { env } = require("../config/env");

const WRITE_KEYWORDS = [
  "create",
  "merge",
  "set",
  "delete",
  "detach delete",
  "remove",
  "drop",
  "call dbms",
  "call db.",
  "load csv",
  "apoc.load",
  "apoc.periodic"
];

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function includesWriteKeyword(normalizedLower) {
  return WRITE_KEYWORDS.some((kw) => normalizedLower.includes(kw));
}

function ensureLimit(query, maxLimit) {
  const normalized = normalizeWhitespace(query);
  const limitMatch = normalized.match(/\blimit\s+(\d+)\b/i);
  if (limitMatch) {
    const requested = Number.parseInt(limitMatch[1], 10);
    const clamped = Number.isFinite(requested) ? Math.min(requested, maxLimit) : maxLimit;
    if (requested === clamped) return query;
    // Replace only the first LIMIT <n>
    return query.replace(/\blimit\s+\d+\b/i, `LIMIT ${clamped}`);
  }
  if (/\blimit\b/i.test(normalized)) {
    const err = new Error("Rejected: LIMIT must be a numeric literal.");
    err.statusCode = 400;
    throw err;
  }
  return `${query.trim()}\nLIMIT ${maxLimit}`;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function validateReadOnlyCypher(query) {
  if (typeof query !== "string" || query.trim() === "") {
    const err = new Error("Query must be a non-empty string.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedLower = normalizeWhitespace(query).toLowerCase();
  if (includesWriteKeyword(normalizedLower)) {
    const err = new Error("Rejected: only read-only Cypher is allowed.");
    err.statusCode = 400;
    throw err;
  }
}

function buildSafeCypher({ query, requestedLimit }) {
  validateReadOnlyCypher(query);
  const effectiveLimit = clampInt(requestedLimit, {
    min: 1,
    max: env.querySafety.maxLimit,
    fallback: Math.min(200, env.querySafety.maxLimit)
  });
  const limited = ensureLimit(query, effectiveLimit);
  return { query: limited, limit: effectiveLimit, timeoutMs: env.querySafety.timeoutMs };
}

module.exports = { buildSafeCypher };
