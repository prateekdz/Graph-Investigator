const express = require("express");
const { runCypher } = require("../db/neo4j");
const { env } = require("../config/env");
const { GraphStore } = require("../../services/graphStore");
const { search: fileSearch } = require("../../services/searchService");
const { guardQuestion } = require("../utils/guardrails");
const { ask: askLlmQuery } = require("../services/llm/llmService");

let fallbackGraphStorePromise = null;

async function getFallbackGraphStore() {
  if (!fallbackGraphStorePromise) {
    fallbackGraphStorePromise = (async () => {
      const gs = new GraphStore();
      await gs.load();
      // eslint-disable-next-line no-console
      console.log(`[fallback] file graph loaded: nodes=${gs.nodesById.size.toLocaleString()} edges=${gs.edges.length.toLocaleString()}`);
      return gs;
    })();
  }
  return fallbackGraphStorePromise;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nodeKeyFromNeo(node) {
  const p = node?.properties || {};
  const type = String(p.entityType || node?.labels?.[0] || "Entity");
  const entityId = p.entityId !== undefined && p.entityId !== null ? String(p.entityId) : String(node?.elementId || node?.identity);
  return { type, entityId, id: `${type}:${entityId}` };
}

function labelFor(type, fields) {
  if (type === "Customer") return fields.businessPartnerFullName || fields.businessPartnerName || fields.entityId || "Customer";
  if (type === "Order") return `Order ${fields.entityId || fields.salesOrder || ""}`.trim();
  if (type === "Delivery") return `Delivery ${fields.entityId || fields.deliveryDocument || ""}`.trim();
  if (type === "Invoice") return `Invoice ${fields.entityId || fields.billingDocument || ""}`.trim();
  if (type === "Payment") return `Payment ${fields.accountingDocument || fields.entityId || ""}`.trim();
  if (type === "JournalEntryItem") return `Journal Entry ${fields.accountingDocument || fields.entityId || ""}`.trim();
  return type;
}

function nodeColor(type) {
  const primary = new Set(["Customer", "Order", "Delivery", "Invoice", "Payment", "JournalEntryItem"]);
  if (primary.has(type)) return "#60a5fa";
  return "#f87171";
}

function toUiNode(neoNode, degree = 0) {
  const { type, entityId, id } = nodeKeyFromNeo(neoNode);
  const fields = neoNode?.properties || {};
  return {
    id,
    type,
    label: labelFor(type, fields),
    fields,
    connections: degree,
    primary: ["Customer", "Order", "Delivery", "Invoice", "Payment", "JournalEntryItem"].includes(type),
    color: nodeColor(type),
    entityId
  };
}

function extractIdCandidate(text) {
  const s = String(text || "");
  const num = s.match(/\b\d{6,12}\b/);
  if (num) return num[0];
  const alphaNum = s.match(/\b[A-Z][A-Z0-9]{8,20}\b/);
  if (alphaNum) return alphaNum[0];
  return null;
}

function heuristicEntity(q) {
  const s = String(q || "").toLowerCase();
  if (s.includes("invoice") || s.includes("billing")) return "Invoice";
  if (s.includes("sales order") || (s.includes("order") && !s.includes("purchase"))) return "Order";
  if (s.includes("delivery") || s.includes("shipment")) return "Delivery";
  if (s.includes("payment") || s.includes("clearing")) return "Payment";
  if (s.includes("journal")) return "JournalEntryItem";
  if (s.includes("customer") || s.includes("business partner") || s.includes("sold-to")) return "Customer";
  return null;
}

async function getGraph({ limit }) {
  const effectiveLimit = clampInt(limit, { min: 50, max: 2000, fallback: 600 });

  const q = `
MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT $limit
`;
  const res = await runCypher({ query: q, params: { limit: effectiveLimit }, timeoutMs: env.querySafety.timeoutMs });

  const degrees = new Map();
  const nodeMap = new Map();
  const links = [];

  for (const rec of res.records) {
    const n = rec.get("n");
    const m = rec.get("m");
    const r = rec.get("r");
    const nk = nodeKeyFromNeo(n);
    const mk = nodeKeyFromNeo(m);

    degrees.set(nk.id, (degrees.get(nk.id) || 0) + 1);
    degrees.set(mk.id, (degrees.get(mk.id) || 0) + 1);

    nodeMap.set(nk.id, n);
    nodeMap.set(mk.id, m);

    links.push({
      id: `${nk.id}->${mk.id}:${String(r?.type || "RELATED")}:${String(r?.elementId || "")}`,
      source: nk.id,
      target: mk.id,
      relationship: String(r?.type || "RELATED")
    });
  }

  const nodes = Array.from(nodeMap.entries()).map(([id, neo]) => toUiNode(neo, degrees.get(id) || 0));

  return { nodes, links };
}

async function getNode({ id }) {
  const raw = String(id || "");
  const [entityType, ...rest] = raw.split(":");
  const entityId = rest.join(":");
  if (!entityType || !entityId) return null;

  const q = `
MATCH (n { entityType: $entityType, entityId: $entityId })
OPTIONAL MATCH (n)-[r]-(m)
RETURN n, collect({ r: r, m: m }) AS rels
`;
  const res = await runCypher({
    query: q,
    params: { entityType, entityId },
    timeoutMs: env.querySafety.timeoutMs
  });
  const rec = res.records[0];
  if (!rec) return null;

  const n = rec.get("n");
  const rels = rec.get("rels") || [];
  const degrees = (rels || []).length;

  const neighbors = [];
  const edges = [];
  for (const item of rels) {
    const m = item?.m;
    const r = item?.r;
    if (!m || !r) continue;
    const mk = nodeKeyFromNeo(m);
    neighbors.push(toUiNode(m));
    edges.push({
      source: `${entityType}:${entityId}`,
      target: mk.id,
      relationship: String(r.type || "RELATED")
    });
  }

  return { node: toUiNode(n, degrees), neighbors, edges };
}

function fileSnapshotToGraph(snapshot) {
  return {
    nodes: snapshot.nodes || [],
    links: (snapshot.edges || []).map((e, i) => ({
      id: `${e.source}->${e.target}:${e.relationship}:${i}`,
      source: e.source,
      target: e.target,
      relationship: e.relationship
    }))
  };
}

async function fallbackGraph({ reason }) {
  const gs = await getFallbackGraphStore();
  const snap = gs.snapshot();
  const graph = fileSnapshotToGraph(snap);
  return {
    ...graph,
    meta: {
      source: "file",
      loadedAt: snap.loadedAt,
      reason: reason || "neo4j_unavailable"
    }
  };
}

async function fallbackNode({ id }) {
  const gs = await getFallbackGraphStore();
  const data = gs.entityById(id);
  if (!data) return null;
  return { ...data, meta: { source: "file" } };
}

async function fallbackSearch({ q }) {
  const gs = await getFallbackGraphStore();
  return fileSearch({ q, graphStore: gs, guardQuestion });
}

async function searchByQuery({ q }) {
  const question = String(q || "").trim();
  const id = extractIdCandidate(question);
  const entityType = heuristicEntity(question);

  if (!id) {
    return { found: false, message: "Please include an id (e.g. invoice 91150187)." };
  }

  const candidateTypes = entityType
    ? [entityType]
    : [/^\d{6}$/.test(id)
        ? ["Order"]
        : /^\d{8}$/.test(id)
          ? ["Invoice", "Delivery"]
          : /^\d{9}$/.test(id)
            ? ["Customer"]
            : ["Invoice", "Order", "Delivery", "Payment", "JournalEntryItem", "Customer"]];

  for (const t of candidateTypes) {
    const nodeId = `${t}:${id}`;
    const data = await getNode({ id: nodeId });
    if (data?.node?.id) {
      return {
        found: true,
        mainNode: data.node,
        connections: data.neighbors,
        edges: data.edges,
        highlights: [data.node.id]
      };
    }
  }

  return { found: false, message: "Record not found in dataset." };
}

function buildChatResponse({ question, searchResult }) {
  if (!searchResult?.found || !searchResult?.mainNode)
    return {
      text: searchResult?.message || "Record not found in dataset.",
      suggestions: [
        { label: "Search invoice", query: "Find invoice <id>" },
        { label: "Search order", query: "Get order <id>" }
      ],
      blocks: []
    };

  const q = String(question || "").toLowerCase();
  const node = searchResult.mainNode;
  const id = node?.fields?.entityId || node?.entityId || (node?.id ? String(node.id).split(":").slice(1).join(":") : "");
  const connectionsCount = Array.isArray(searchResult.connections) ? searchResult.connections.length : 0;
  const connections = Array.isArray(searchResult.connections) ? searchResult.connections : [];

  function fieldFirst(...keys) {
    const f = node?.fields || {};
    for (const k of keys) {
      const v = f?.[k];
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  }

  function pickCurrency() {
    return fieldFirst("transactionCurrency", "companyCodeCurrency", "currency", "Currency");
  }

  function pickAmount() {
    const v =
      fieldFirst("totalNetAmount", "amountInTransactionCurrency", "amountInCompanyCodeCurrency", "amount", "Amount");
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return { value: n, currency: pickCurrency() };
  }

  function pickDate() {
    return fieldFirst("creationDate", "billingDocumentDate", "postingDate", "documentDate", "clearingDate");
  }

  function formatMoney(a) {
    if (!a) return null;
    const currency = a.currency ? String(a.currency) : "";
    const value = a.value;
    try {
      if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    } catch {
      return currency ? `${currency} ${value}` : String(value);
    }
  }

  function pickContextBullets() {
    const bullets = [];
    const companyCode = fieldFirst("companyCode", "CompanyCode");
    const fiscalYear = fieldFirst("fiscalYear", "FiscalYear");
    const amount = pickAmount();
    const date = pickDate();

    if (companyCode) bullets.push(`- **Company Code:** ${companyCode}`);
    if (fiscalYear) bullets.push(`- **Fiscal Year:** ${fiscalYear}`);
    if (amount) bullets.push(`- **Amount:** ${formatMoney(amount)}`);
    if (date) bullets.push(`- **Date:** ${String(date).slice(0, 10)}`);

    return bullets;
  }

  const suggestions = [
    { label: "Trace full flow", query: `Trace ${node.type} ${id}` },
    { label: "Show neighbors", query: `Show connected records for ${node.type} ${id}` }
  ];

  function connectionStats(list) {
    const byType = new Map();
    for (const n of list || []) {
      const t = String(n?.type || "Entity");
      byType.set(t, (byType.get(t) || 0) + 1);
    }
    return Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }

  function pickEvidenceFields(n) {
    const f = n?.fields || {};
    const out = [];
    const add = (label, value) => {
      if (value === null || value === undefined || value === "") return;
      out.push({ label, value: String(value) });
    };

    add("Entity", n?.type || "Entity");
    add("ID", f.entityId || n?.entityId || (n?.id ? String(n.id).split(":").slice(1).join(":") : ""));
    add("CompanyCode", f.companyCode || f.CompanyCode);
    add("FiscalYear", f.fiscalYear || f.FiscalYear);
    add("AccountingDocument", f.accountingDocument || f.AccountingDocument);
    add("BillingDocument", f.billingDocument || f.BillingDocument);
    add("SalesOrder", f.salesOrder || f.SalesOrder);
    add("DeliveryDocument", f.deliveryDocument || f.DeliveryDocument);
    add("ReferenceDocument", f.referenceDocument || f.ReferenceDocument || f.referenceBillingDocument);
    add("PostingDate", f.postingDate || f.PostingDate);
    add("DocumentDate", f.documentDate || f.DocumentDate);
    add("ClearingDate", f.clearingDate || f.ClearingDate);

    const amount = f.totalNetAmount ?? f.amountInTransactionCurrency ?? f.amountInCompanyCodeCurrency ?? f.amount ?? null;
    const currency = f.transactionCurrency || f.companyCodeCurrency || f.currency || f.Currency || null;
    if (amount !== null && amount !== undefined && amount !== "") add("Amount", `${currency ? `${currency} ` : ""}${amount}`);

    return out.slice(0, 12);
  }

  function buildRecordBlock({ main, related }) {
    if (!main) return null;
    const stats = connectionStats(related || []);
    return {
      kind: "record",
      node: { id: main.id, type: main.type, label: main.label || null },
      evidence: pickEvidenceFields(main),
      connections: stats,
      totals: { connections: Array.isArray(related) ? related.length : 0 }
    };
  }

  if (q.includes("journal") && node.type === "Invoice") {
    const je = (searchResult.connections || []).find((n) => n?.type === "JournalEntryItem");
    const jeNum = je?.fields?.accountingDocument ? String(je.fields.accountingDocument) : null;
    if (jeNum)
      return {
        text:
          `Here’s what I found 👇\n\n` +
          `📄 **Journal Entry Details**\n` +
          `- **Document Number:** ${jeNum}\n` +
          `- **Linked Billing Document:** ${id}\n\n` +
          `🔗 This entry is directly connected to the billing document you referenced.\n\n` +
          `If you want, I can trace the end-to-end flow from Customer → Payment.`,
        suggestions: [
          { label: "Trace full flow", query: `Trace invoice ${id}` },
          { label: "Open journal entry", query: `Find journal entry ${jeNum}` }
        ],
        blocks: [
          buildRecordBlock({ main: node, related: connections }),
          buildRecordBlock({ main: je, related: connections })
        ].filter(Boolean)
      };
    return {
      text:
        `I looked for a linked journal entry for **Invoice ${id}**, but couldn’t find one in the dataset.\n\n` +
        `- **Connections scanned:** ${connectionsCount}\n\n` +
        `Try searching the accounting document number directly if you have it.`,
      suggestions: [{ label: "Search journal entry", query: "Find journal entry <document number>" }],
      blocks: [buildRecordBlock({ main: node, related: connections })].filter(Boolean)
    };
  }

  const header = `Here’s what I found 👇`;
  const title = `📄 **${node.type}**`;
  const bullets = [`- **ID:** ${id}`, ...pickContextBullets(), `- **Connections:** ${connectionsCount}`].join("\n");
  const explain = `🔗 This record is connected to ${connectionsCount} related entity${connectionsCount === 1 ? "" : "ies"} in the graph.`;
  const next = `What would you like to do next?`;

  return {
    text: `${header}\n\n${title}\n${bullets}\n\n${explain}\n\n${next}`,
    suggestions,
    blocks: [buildRecordBlock({ main: node, related: connections })].filter(Boolean)
  };
}

const router = express.Router();

function nodeIdFromNeoLike(value) {
  const props = value?.properties || value?.props || value?.fields || null;
  const labels = Array.isArray(value?.labels) ? value.labels : Array.isArray(value?.label) ? value.label : null;
  const entityType = props?.entityType || (Array.isArray(labels) ? labels[0] : null) || null;
  const entityId = props?.entityId ?? null;
  if (!entityType || entityId === null || entityId === undefined) return null;
  return `${String(entityType)}:${String(entityId)}`;
}

function extractHighlightIdsFromRecords(records) {
  const highlights = new Set();

  const walk = (v) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v !== "object") return;

    const maybeId = nodeIdFromNeoLike(v);
    if (maybeId) highlights.add(maybeId);

    for (const k of Object.keys(v)) {
      walk(v[k]);
    }
  };

  for (const r of records || []) walk(r);
  return Array.from(highlights).slice(0, 200);
}

router.post("/ask", async (req, res, next) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Missing question" });

    async function respondWithFileFallback({ reason, warning }) {
      const gs = await getFallbackGraphStore();
      const result = await fileSearch({ q: question, graphStore: gs, guardQuestion });

      if (result?.rejected) {
        const msg = result?.message || "Rejected query.";
        return res.status(200).json({
          rejected: true,
          message: msg,
          answer: msg,
          highlights: [],
          blocks: [],
          suggestions: [],
          meta: { source: "file", reason: reason || "rejected" }
        });
      }

      if (!result?.found) {
        // If the intent extractor couldn't confidently map an entity type, try direct id lookup across core types.
        const token = extractIdCandidate(question);
        if (token) {
          const core = ["Invoice", "Order", "Delivery", "JournalEntry", "Payment", "Customer", "Product"];
          for (const t of core) {
            const nodeId = `${t}:${token}`;
            const details = gs.entityById(nodeId);
            if (details?.node?.id) {
              const built = buildChatResponse({
                question,
                searchResult: { found: true, mainNode: details.node, connections: details.neighbors || [] }
              });
              const header = warning ? `Note: ${warning}\n\n` : "";
              return res.status(200).json({
                answer: `${header}${built.text || ""}`.trim(),
                highlights: [details.node.id],
                blocks: Array.isArray(built.blocks) ? built.blocks : [],
                suggestions: Array.isArray(built.suggestions) ? built.suggestions : [],
                meta: { source: "file", reason: reason || "direct_id_lookup" }
              });
            }
          }

          // Surface best-effort candidates so the user isn't blocked by strict matching.
          const candidates = gs
            .findByToken(token)
            .filter((n) => n?.primary)
            .slice(0, 5);
          if (candidates.length) {
            const header = warning ? `Note: ${warning}\n\n` : "";
            const list = candidates
              .map((n) => {
                const id = n?.fields?.entityId || n?.entityId || String(n.id).split(":").slice(1).join(":");
                return `- **${n.type}:** ${id}`;
              })
              .join("\n");
            return res.status(200).json({
              answer: `${header}No exact record found for **${token}**.\n\nClosest matches in the dataset:\n${list}`,
              highlights: candidates.map((n) => n.id),
              blocks: [],
              suggestions: candidates.map((n) => {
                const id = n?.fields?.entityId || n?.entityId || String(n.id).split(":").slice(1).join(":");
                return { label: `Open ${n.type}`, query: `Find ${n.type} ${id}` };
              }),
              meta: { source: "file", reason: reason || "candidates" }
            });
          }
        }

        // If there's no obvious id in the question, offer real, dataset-backed examples.
        const hintedEntity = result?.intent?.entity || heuristicEntity(question);
        const mappedEntity =
          hintedEntity === "JournalEntryItem" ? "JournalEntry" : hintedEntity === "BusinessPartner" ? "Customer" : hintedEntity;

        if (mappedEntity) {
          const pool = gs.entitiesByType(mappedEntity).filter((n) => n?.primary).slice(0, 5);
          if (pool.length) {
            const header = warning ? `Note: ${warning}\n\n` : "";
            const examples = pool
              .map((n) => {
                const id = n?.fields?.entityId || n?.entityId || String(n.id).split(":").slice(1).join(":");
                return `- **${n.type}:** ${id}`;
              })
              .join("\n");
            return res.status(200).json({
              answer:
                `${header}No exact record found for that query.\n\n` +
                `Try a specific id. Example ${mappedEntity} records from the dataset:\n${examples}`,
              highlights: pool.map((n) => n.id),
              blocks: [],
              suggestions: pool.map((n) => {
                const id = n?.fields?.entityId || n?.entityId || String(n.id).split(":").slice(1).join(":");
                return { label: `Open ${n.type}`, query: `Find ${n.type} ${id}` };
              }),
              meta: { source: "file", reason: reason || "examples" }
            });
          }
        }

        const msg = result?.message || "Record not found in dataset.";
        const header = warning ? `Note: ${warning}\n\n` : "";
        return res.status(200).json({
          answer: `${header}${msg}`,
          highlights: [],
          blocks: [],
          suggestions: [
            { label: "Find invoice", query: "Find invoice <id>" },
            { label: "Trace order", query: "Trace order <id>" }
          ],
          meta: { source: "file", reason: reason || "not_found" }
        });
      }

      const built = buildChatResponse({
        question,
        searchResult: { found: true, mainNode: result.mainNode, connections: result.connections || [] }
      });

      const header = warning ? `Note: ${warning}\n\n` : "";
      return res.status(200).json({
        answer: `${header}${built.text || result.answer || ""}`.trim(),
        highlights: Array.isArray(result.highlights) ? result.highlights : [],
        blocks: Array.isArray(built.blocks) ? built.blocks : [],
        suggestions: Array.isArray(built.suggestions) ? built.suggestions : [],
        meta: { source: "file", reason: reason || "fallback" }
      });
    }

    // Neo4j is required for NL -> Cypher execution; when unavailable, fall back to dataset-backed lookup.
    if (!env.neo4j.enabled) {
      return respondWithFileFallback({
        reason: "neo4j_disabled",
        warning: "Neo4j is disabled, so NL -> Cypher execution is unavailable. Showing dataset-backed lookup results."
      });
    }

    // Provider config sanity check.
    const provider = String(process.env.LLM_PROVIDER || "").toLowerCase();
    if (provider === "gemini" && !String(process.env.GEMINI_API_KEY || "").trim()) {
      return respondWithFileFallback({
        reason: "llm_missing_key",
        warning: "GEMINI_API_KEY is not set, so NL -> query translation is unavailable. Showing dataset-backed lookup results."
      });
    }
    if (provider === "groq" && !String(process.env.GROQ_API_KEY || "").trim()) {
      return respondWithFileFallback({
        reason: "llm_missing_key",
        warning: "GROQ_API_KEY is not set, so NL -> query translation is unavailable. Showing dataset-backed lookup results."
      });
    }

    // Fast-path: if Neo4j isn't reachable, skip the LLM call and fall back immediately.
    try {
      await runCypher({
        query: "RETURN 1 AS ok",
        params: {},
        timeoutMs: Math.min(1200, env.querySafety.timeoutMs)
      });
    } catch (e) {
      return respondWithFileFallback({
        reason: "neo4j_unreachable",
        warning: "Neo4j is not reachable, so NL -> Cypher execution is unavailable. Showing dataset-backed lookup results."
      });
    }

    let out;
    try {
      out = await askLlmQuery({ question });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/failed to connect|ECONNREFUSED|ServiceUnavailable/i.test(msg)) {
        return respondWithFileFallback({
          reason: "neo4j_unreachable",
          warning: "Neo4j is not reachable, so NL -> Cypher execution is unavailable. Showing dataset-backed lookup results."
        });
      }
      return respondWithFileFallback({
        reason: "llm_failed",
        warning: `LLM request failed (${provider || "unknown"}). Showing dataset-backed lookup results.`
      });
    }

    const highlights = extractHighlightIdsFromRecords(out?.records || []);
    return res.status(200).json({
      rejected: Boolean(out?.rejected),
      needsClarification: Boolean(out?.needsClarification),
      clarificationQuestion: out?.clarificationQuestion || null,
      language: out?.language || null,
      query: out?.query || null,
      params: out?.params || null,
      answer: out?.answer || null,
      records: out?.records || [],
      highlights,
      blocks: out?.query
        ? [
            {
              kind: "query",
              language: out?.language || "cypher",
              query: out?.query
            }
          ]
        : []
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/graph", async (req, res, next) => {
  try {
    const { limit } = req.query;
    if (!env.neo4j.enabled) {
      const fb = await fallbackGraph({ reason: "neo4j_disabled" });
      return res.json({ nodes: fb.nodes, links: fb.links, limit: fb.links.length, meta: fb.meta });
    }
    try {
      const data = await getGraph({ limit });
      if (!data.nodes || data.nodes.length === 0) {
        return res.status(503).json({
          error:
            "Neo4j returned zero nodes. Run the importer first: `cd backend && npm run import:o2c` (ensure Neo4j is running on bolt://localhost:7687).",
          nodes: [],
          links: []
        });
      }
      return res.json({ nodes: data.nodes, links: data.links, limit: data.links.length, meta: { source: "neo4j" } });
    } catch (err) {
      const msg = err?.message || String(err);
      // eslint-disable-next-line no-console
      console.error("[api] /api/graph neo4j failed, falling back to file graph:", msg);
      const fb = await fallbackGraph({ reason: msg });
      return res.json({ nodes: fb.nodes, links: fb.links, limit: fb.links.length, meta: fb.meta, warning: "Neo4j is not reachable; using file dataset fallback." });
    }
  } catch (err) {
    return next(err);
  }
});

router.get("/node/:id", async (req, res, next) => {
  try {
    if (!env.neo4j.enabled) {
      const data = await fallbackNode({ id: req.params.id });
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    }
    try {
      const data = await getNode({ id: req.params.id });
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    } catch (err) {
      const msg = err?.message || String(err);
      // eslint-disable-next-line no-console
      console.error("[api] /api/node neo4j failed, falling back to file graph:", msg);
      const data = await fallbackNode({ id: req.params.id });
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    }
  } catch (err) {
    return next(err);
  }
});

router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "");
    if (!env.neo4j.enabled) {
      const result = await fallbackSearch({ q });
      return res.json(result);
    }
    try {
      const result = await searchByQuery({ q });
      return res.json(result);
    } catch (err) {
      const msg = err?.message || String(err);
      // eslint-disable-next-line no-console
      console.error("[api] /api/search neo4j failed, falling back to file search:", msg);
      const result = await fallbackSearch({ q });
      return res.json(result);
    }
  } catch (err) {
    return next(err);
  }
});

router.post("/chat", async (req, res, next) => {
  try {
    const { messages } = req.body || {};
    const lastUser = Array.isArray(messages) ? [...messages].reverse().find((m) => m?.role === "user") : null;
    const question = lastUser?.content || "";
    let searchResult;
    try {
      searchResult = await searchByQuery({ q: question });
    } catch (err) {
      const msg = err?.message || String(err);
      // eslint-disable-next-line no-console
      console.error("[api] /api/chat neo4j failed, falling back to file search:", msg);
      searchResult = await fallbackSearch({ q: question });
      // normalize file search shape to the expected chat shape
      if (searchResult?.found && searchResult?.mainNode) {
        searchResult = {
          found: true,
          mainNode: searchResult.mainNode,
          connections: searchResult.connections || [],
          edges: searchResult.edges || [],
          highlights: [searchResult.mainNode.id]
        };
      }
    }

    const built = buildChatResponse({ question, searchResult });
    const response = typeof built === "string" ? built : built?.text;
    const suggestions = typeof built === "string" ? [] : built?.suggestions || [];
    const blocks = typeof built === "string" ? [] : built?.blocks || [];

    if (!searchResult.found) {
      return res.json({ response, suggestions, blocks, rejected: false, found: false, highlights: [] });
    }

    return res.json({
      response,
      suggestions,
      blocks,
      rejected: false,
      found: true,
      mainNode: searchResult.mainNode,
      connections: searchResult.connections || [],
      edges: searchResult.edges || [],
      highlights: searchResult.highlights || [searchResult.mainNode.id]
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router };
