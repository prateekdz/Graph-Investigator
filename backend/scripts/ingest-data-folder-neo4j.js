const { buildGraphFromDataDir, resolveDataDir } = require("../services/graphBuilder");
const { runCypher, closeDriver } = require("../src/db/neo4j");
const { env } = require("../src/config/env");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [k, maybeV] = token.split("=");
    const key = k.replace(/^--/, "");
    if (maybeV !== undefined) args[key] = maybeV;
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function mapTypeToLabel(type) {
  switch (type) {
    case "SalesOrder":
      return "Order";
    case "SalesOrderItem":
      return "OrderLine";
    case "BillingDocument":
      return "Invoice";
    case "BillingDocumentItem":
      return "InvoiceLine";
    case "Delivery":
      return "Delivery";
    case "DeliveryItem":
      return "DeliveryLine";
    case "Customer":
      return "Customer";
    case "Product":
      return "Product";
    case "Address":
      return "Address";
    case "JournalEntry":
      return "JournalEntryItem";
    case "Payment":
      return "Payment";
    default:
      return "Entity";
  }
}

function mapRel(rel) {
  switch (rel) {
    case "HAS_ITEM":
      return "HAS_LINE";
    case "MATERIAL":
      return "ITEM";
    case "BILLS":
      return "CHARGES";
    default:
      return rel;
  }
}

function splitNodeId(nodeId) {
  const s = String(nodeId);
  const idx = s.indexOf(":");
  if (idx === -1) return { type: "Entity", key: s };
  return { type: s.slice(0, idx), key: s.slice(idx + 1) };
}

async function ensureConstraints() {
  await runCypher({
    query: "CREATE CONSTRAINT entity_entityKey IF NOT EXISTS FOR (n:Entity) REQUIRE n.entityKey IS UNIQUE"
  });
}

async function resetDb() {
  await runCypher({ query: "MATCH (n) DETACH DELETE n" });
}

async function main() {
  const args = parseArgs(process.argv);
  const rawDir = args.dataDir || process.env.DATA_DIR;
  const dataDir = resolveDataDir(rawDir);
  const batchSize = clampInt(args.batchSize, { min: 100, max: 5000, fallback: 1000 });
  const reset = Boolean(args.reset);

  // eslint-disable-next-line no-console
  console.log("Neo4j ingest (from /data folder)");
  // eslint-disable-next-line no-console
  console.log(`- dataDir: ${dataDir}`);
  // eslint-disable-next-line no-console
  console.log(`- neo4j: ${env.neo4j.uri} (db=${env.neo4j.database})`);
  // eslint-disable-next-line no-console
  console.log(`- reset: ${reset}`);
  // eslint-disable-next-line no-console
  console.log(`- batchSize: ${batchSize}`);

  const graph = await buildGraphFromDataDir(dataDir);
  // eslint-disable-next-line no-console
  console.log(`- parsed: nodes=${graph.nodes.length} edges=${graph.edges.length}`);

  try {
    if (reset) await resetDb();
    await ensureConstraints();

    // Upsert nodes
    const nodeRows = graph.nodes.map((n) => {
      const split = splitNodeId(n.id);
      const label = mapTypeToLabel(n.type);
      return {
        label,
        entityId: split.key,
        entityType: label,
        entityKey: `${label}:${split.key}`,
        sourceType: n.type,
        sourceId: n.id,
        fields: n.fields || {},
        labelText: n.label || label
      };
    });

    for (let i = 0; i < nodeRows.length; i += batchSize) {
      const chunk = nodeRows.slice(i, i + batchSize);
      // eslint-disable-next-line no-console
      console.log(`[nodes] writing ${i + 1}-${Math.min(i + batchSize, nodeRows.length)} / ${nodeRows.length}`);
      await runCypher({
        query: `
UNWIND $rows AS row
MERGE (n:Entity { entityKey: row.entityKey })
SET n.entityType = row.entityType
SET n.entityId = row.entityId
SET n.sourceType = row.sourceType
SET n.sourceId = row.sourceId
SET n.label = row.labelText
SET n += row.fields
FOREACH (_ IN CASE WHEN row.entityType = "Customer" THEN [1] ELSE [] END | SET n:Customer)
FOREACH (_ IN CASE WHEN row.entityType = "Address" THEN [1] ELSE [] END | SET n:Address)
FOREACH (_ IN CASE WHEN row.entityType = "Product" THEN [1] ELSE [] END | SET n:Product)
FOREACH (_ IN CASE WHEN row.entityType = "Order" THEN [1] ELSE [] END | SET n:Order)
FOREACH (_ IN CASE WHEN row.entityType = "OrderLine" THEN [1] ELSE [] END | SET n:OrderLine)
FOREACH (_ IN CASE WHEN row.entityType = "Delivery" THEN [1] ELSE [] END | SET n:Delivery)
FOREACH (_ IN CASE WHEN row.entityType = "DeliveryLine" THEN [1] ELSE [] END | SET n:DeliveryLine)
FOREACH (_ IN CASE WHEN row.entityType = "Invoice" THEN [1] ELSE [] END | SET n:Invoice)
FOREACH (_ IN CASE WHEN row.entityType = "InvoiceLine" THEN [1] ELSE [] END | SET n:InvoiceLine)
FOREACH (_ IN CASE WHEN row.entityType = "Payment" THEN [1] ELSE [] END | SET n:Payment)
FOREACH (_ IN CASE WHEN row.entityType = "JournalEntryItem" THEN [1] ELSE [] END | SET n:JournalEntryItem)
RETURN count(*) AS written
`,
        params: { rows: chunk },
        timeoutMs: env.querySafety.timeoutMs
      });
    }

    // Upsert relationships
    const relRows = graph.edges.map((e) => {
      const s = splitNodeId(e.source);
      const t = splitNodeId(e.target);
      const sLabel = mapTypeToLabel(s.type);
      const tLabel = mapTypeToLabel(t.type);
      return {
        sourceKey: `${sLabel}:${s.key}`,
        targetKey: `${tLabel}:${t.key}`,
        type: mapRel(e.relationship)
      };
    });

    for (let i = 0; i < relRows.length; i += batchSize) {
      const chunk = relRows.slice(i, i + batchSize);
      // eslint-disable-next-line no-console
      console.log(`[rels] writing ${i + 1}-${Math.min(i + batchSize, relRows.length)} / ${relRows.length}`);
      await runCypher({
        query: `
UNWIND $rows AS row
MATCH (a:Entity { entityKey: row.sourceKey })
MATCH (b:Entity { entityKey: row.targetKey })
FOREACH (_ IN CASE WHEN row.type = "HAS_LINE" THEN [1] ELSE [] END | MERGE (a)-[:HAS_LINE]->(b))
FOREACH (_ IN CASE WHEN row.type = "ITEM" THEN [1] ELSE [] END | MERGE (a)-[:ITEM]->(b))
FOREACH (_ IN CASE WHEN row.type = "FULFILLS" THEN [1] ELSE [] END | MERGE (a)-[:FULFILLS]->(b))
FOREACH (_ IN CASE WHEN row.type = "CHARGES" THEN [1] ELSE [] END | MERGE (a)-[:CHARGES]->(b))
FOREACH (_ IN CASE WHEN row.type = "PLACED" THEN [1] ELSE [] END | MERGE (a)-[:PLACED]->(b))
FOREACH (_ IN CASE WHEN row.type = "BILLED" THEN [1] ELSE [] END | MERGE (a)-[:BILLED]->(b))
FOREACH (_ IN CASE WHEN row.type = "AR_FOR" THEN [1] ELSE [] END | MERGE (a)-[:AR_FOR]->(b))
FOREACH (_ IN CASE WHEN row.type = "CLEARS" THEN [1] ELSE [] END | MERGE (a)-[:CLEARS]->(b))
RETURN count(*) AS written
`,
        params: { rows: chunk },
        timeoutMs: env.querySafety.timeoutMs
      });
    }

    // Derive APPLIED_TO: Payment -> JournalEntryItem -> Invoice
    await runCypher({
      query: `
MATCH (p:Payment)-[:CLEARS]->(je:JournalEntryItem)-[:AR_FOR]->(i:Invoice)
MERGE (p)-[:APPLIED_TO]->(i)
RETURN count(*) AS written
`,
      timeoutMs: env.querySafety.timeoutMs
    });

    // eslint-disable-next-line no-console
    console.log("Ingest complete.");
  } finally {
    await closeDriver();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
