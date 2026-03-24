const DATASET_TABLES = [
  "sales_order_headers",
  "sales_order_items",
  "sales_order_schedule_lines",
  "outbound_delivery_headers",
  "outbound_delivery_items",
  "billing_document_headers",
  "billing_document_items",
  "billing_document_cancellations",
  "business_partners",
  "business_partner_addresses",
  "customer_company_assignments",
  "customer_sales_area_assignments",
  "payments_accounts_receivable",
  "journal_entry_items_accounts_receivable",
  "products",
  "product_descriptions",
  "product_plants",
  "product_storage_locations",
  "plants"
];

const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "copy",
  "execute",
  "call"
];

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function ensureLimit(sql, maxLimit) {
  const normalized = normalizeWhitespace(sql);
  const match = normalized.match(/\blimit\s+(\d+)\b/i);
  if (match) {
    const requested = Number.parseInt(match[1], 10);
    const clamped = Number.isFinite(requested) ? Math.min(requested, maxLimit) : maxLimit;
    if (requested === clamped) return sql;
    return sql.replace(/\blimit\s+\d+\b/i, `LIMIT ${clamped}`);
  }
  if (/\blimit\b/i.test(normalized)) {
    const err = new Error("Rejected: LIMIT must be a numeric literal.");
    err.statusCode = 400;
    throw err;
  }
  return `${sql.trim()}\nLIMIT ${maxLimit}`;
}

function validateSqlDatasetOnly(sql) {
  const s = normalizeWhitespace(sql);
  const lower = s.toLowerCase();

  if (!lower.startsWith("select") && !lower.startsWith("with")) {
    const err = new Error("Rejected: only SELECT (or WITH ... SELECT) queries are allowed.");
    err.statusCode = 400;
    throw err;
  }

  if (FORBIDDEN.some((kw) => lower.includes(kw))) {
    const err = new Error("Rejected: forbidden SQL keyword present.");
    err.statusCode = 400;
    throw err;
  }

  if (s.includes(";")) {
    const err = new Error("Rejected: only a single SQL statement is allowed (no semicolons).");
    err.statusCode = 400;
    throw err;
  }

  // Very conservative table allowlist check: look for FROM/JOIN <identifier>
  const allowed = new Set(DATASET_TABLES);
  const re = /\b(from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)/gi;
  let match;
  const seen = new Set();
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(s))) {
    const raw = match[2];
    const table = raw.split(".").slice(-1)[0]; // allow schema.table
    seen.add(table);
  }
  const unknown = Array.from(seen).filter((t) => !allowed.has(t));
  if (unknown.length > 0) {
    const err = new Error(`Rejected: query references non-dataset table(s): ${unknown.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
}

module.exports = { DATASET_TABLES, validateSqlDatasetOnly, ensureLimit };
