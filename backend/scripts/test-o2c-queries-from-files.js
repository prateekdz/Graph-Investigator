const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [k, maybeV] = token.split("=");
    const key = k.replace(/^--/, "");
    if (maybeV !== undefined) {
      args[key] = maybeV;
    } else {
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

async function* readJsonLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

async function listJsonlFiles(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".jsonl"))
    .map((e) => path.join(dirPath, e.name));
}

async function loadAllRows(folderPath) {
  const files = await listJsonlFiles(folderPath);
  const rows = [];
  for (const f of files) {
    // eslint-disable-next-line no-console
    // console.log("reading", f);
    for await (const r of readJsonLines(f)) rows.push(r);
  }
  return rows;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeItemInt(value) {
  if (value === null || value === undefined) return null;
  const n = Number.parseInt(String(value).replace(/^0+/, "") || "0", 10);
  return Number.isFinite(n) ? n : null;
}

function uniqCount(arr) {
  return new Set(arr).size;
}

function pickInvoiceForFullFlow({
  invoiceHeaders,
  invoiceItems,
  journalEntries,
  payments,
  deliveriesById,
  deliveryItemsByDelivery
}) {
  const invoiceToItems = new Map();
  for (const it of invoiceItems) {
    const id = String(it.billingDocument);
    if (!invoiceToItems.has(id)) invoiceToItems.set(id, []);
    invoiceToItems.get(id).push(it);
  }

  const journalByInvoice = new Map();
  for (const je of journalEntries) {
    const ref = je.referenceDocument ? String(je.referenceDocument) : null;
    if (!ref) continue;
    if (!journalByInvoice.has(ref)) journalByInvoice.set(ref, []);
    journalByInvoice.get(ref).push(je);
  }

  const paymentKey = (r) =>
    `${r.companyCode}:${r.fiscalYear}:${r.accountingDocument}:${r.accountingDocumentItem}`;
  const paymentsByKey = new Map();
  for (const p of payments) paymentsByKey.set(paymentKey(p), p);

  let best = null;
  for (const inv of invoiceHeaders) {
    const invoiceId = String(inv.billingDocument);
    const items = invoiceToItems.get(invoiceId) || [];
    if (items.length === 0) continue;

    // needs at least one item referencing a delivery item
    const hasDeliveryRefs = items.some((x) => x.referenceSdDocument && x.referenceSdDocumentItem);
    if (!hasDeliveryRefs) continue;

    const j = journalByInvoice.get(invoiceId) || [];
    const hasPayment = j.some((je) =>
      paymentsByKey.has(
        `${je.companyCode}:${je.fiscalYear}:${je.accountingDocument}:${je.accountingDocumentItem}`
      )
    );

    // needs delivery header present
    const anyDelivery = items.some((x) => deliveriesById.has(String(x.referenceSdDocument)));
    if (!anyDelivery) continue;

    const score = items.length + (hasPayment ? 5 : 0) + (j.length > 0 ? 2 : 0);
    if (!best || score > best.score) best = { invoiceId, score, hasPayment };
  }

  return best?.invoiceId || null;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseDir = path.resolve(
    args.dataDir || path.join(__dirname, "..", "..", "data", "sap-order-to-cash", "sap-o2c-data")
  );
  const topN = Number.parseInt(args.topN || "10", 10);
  const compact = args.compact !== undefined ? Boolean(args.compact) : true;

  if (!fs.existsSync(baseDir)) throw new Error(`dataDir not found: ${baseDir}`);

  const products = await loadAllRows(path.join(baseDir, "products"));
  const productDescriptions = await loadAllRows(path.join(baseDir, "product_descriptions"));
  const invoiceHeaders = await loadAllRows(path.join(baseDir, "billing_document_headers"));
  const invoiceItems = await loadAllRows(path.join(baseDir, "billing_document_items"));
  const deliveries = await loadAllRows(path.join(baseDir, "outbound_delivery_headers"));
  const deliveryItems = await loadAllRows(path.join(baseDir, "outbound_delivery_items"));
  const orders = await loadAllRows(path.join(baseDir, "sales_order_headers"));
  const orderItems = await loadAllRows(path.join(baseDir, "sales_order_items"));
  const customers = await loadAllRows(path.join(baseDir, "business_partners"));
  const journalEntries = await loadAllRows(path.join(baseDir, "journal_entry_items_accounts_receivable"));
  const payments = await loadAllRows(path.join(baseDir, "payments_accounts_receivable"));

  const productNameById = new Map();
  for (const pd of productDescriptions) {
    if (pd.language === "EN" && pd.product) productNameById.set(String(pd.product), pd.productDescription);
  }
  for (const p of products) {
    const id = String(p.product);
    if (!productNameById.has(id) && p.productOldId) productNameById.set(id, p.productOldId);
  }

  // Indexes for tracing
  const deliveriesById = new Map(deliveries.map((d) => [String(d.deliveryDocument), d]));
  const deliveryItemsByKey = new Map(); // deliveryId:itemInt
  const deliveryItemsByDelivery = new Map();
  for (const di of deliveryItems) {
    const delId = String(di.deliveryDocument);
    const itemInt = normalizeItemInt(di.deliveryDocumentItem);
    if (itemInt === null) continue;
    const key = `${delId}:${itemInt}`;
    deliveryItemsByKey.set(key, di);
    if (!deliveryItemsByDelivery.has(delId)) deliveryItemsByDelivery.set(delId, []);
    deliveryItemsByDelivery.get(delId).push(di);
  }

  const orderById = new Map(orders.map((o) => [String(o.salesOrder), o]));
  const orderItemByKey = new Map(); // orderId:itemInt
  for (const oi of orderItems) {
    const so = String(oi.salesOrder);
    const itemInt = normalizeItemInt(oi.salesOrderItem);
    if (itemInt === null) continue;
    orderItemByKey.set(`${so}:${itemInt}`, oi);
  }
  const customerById = new Map(customers.map((c) => [String(c.businessPartner), c]));

  const journalByInvoice = new Map();
  for (const je of journalEntries) {
    const ref = je.referenceDocument ? String(je.referenceDocument) : null;
    if (!ref) continue;
    if (!journalByInvoice.has(ref)) journalByInvoice.set(ref, []);
    journalByInvoice.get(ref).push(je);
  }
  const paymentByKey = new Map(
    payments.map((p) => [
      `${p.companyCode}:${p.fiscalYear}:${p.accountingDocument}:${p.accountingDocumentItem}`,
      p
    ])
  );

  // -------------------------
  // (1) Products with highest billing documents
  // Interpretation: products with the most distinct billing documents (invoices) and highest billed net amount.
  const byProduct = new Map(); // material -> { invoiceIds:Set, amountSum:number, itemCount:number }
  for (const it of invoiceItems) {
    const material = it.material ? String(it.material) : null;
    if (!material) continue;
    const invId = String(it.billingDocument);
    const amt = toNumber(it.netAmount) || 0;
    if (!byProduct.has(material)) byProduct.set(material, { invoiceIds: new Set(), amountSum: 0, itemCount: 0 });
    const agg = byProduct.get(material);
    agg.invoiceIds.add(invId);
    agg.amountSum += amt;
    agg.itemCount += 1;
  }

  const topProducts = Array.from(byProduct.entries())
    .map(([productId, agg]) => ({
      productId,
      productName: productNameById.get(productId) || null,
      distinctBillingDocuments: agg.invoiceIds.size,
      billedItemLines: agg.itemCount,
      billedNetAmountSum: Number(agg.amountSum.toFixed(2))
    }))
    .sort((a, b) => {
      if (b.distinctBillingDocuments !== a.distinctBillingDocuments)
        return b.distinctBillingDocuments - a.distinctBillingDocuments;
      return b.billedNetAmountSum - a.billedNetAmountSum;
    })
    .slice(0, topN);

  const q1 = {
    generatedQuery: `// Cypher (Neo4j)
MATCH (p:Product)<-[:ITEM]-(il:InvoiceLine)<-[:HAS_LINE]-(i:Invoice)
RETURN p.entityId AS productId, p.description AS name,
       count(DISTINCT i.entityId) AS billingDocs,
       sum(coalesce(il.netAmount,0)) AS billedNetAmount
ORDER BY billingDocs DESC, billedNetAmount DESC
LIMIT ${topN}`,
    executionResult: topProducts,
    finalResponse:
      topProducts.length === 0
        ? "No billing document items found to rank products."
        : `Top ${topProducts.length} products by number of distinct billing documents: ` +
          topProducts
            .map(
              (p) =>
                `${p.productId}${p.productName ? ` (${p.productName})` : ""}: ${p.distinctBillingDocuments} billing docs, net ${p.billedNetAmountSum}`
            )
            .join("; ")
  };

  // -------------------------
  // (2) Trace full flow of a billing document
  let invoiceId = args.invoiceId ? String(args.invoiceId) : null;
  if (!invoiceId) {
    invoiceId = pickInvoiceForFullFlow({
      invoiceHeaders,
      invoiceItems,
      journalEntries,
      payments,
      deliveriesById,
      deliveryItemsByDelivery
    });
  }
  if (!invoiceId) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ error: "Could not find an invoice with a complete flow in the dataset." }, null, 2));
    return;
  }

  const invHeader = invoiceHeaders.find((x) => String(x.billingDocument) === invoiceId) || null;
  const invItems = invoiceItems.filter((x) => String(x.billingDocument) === invoiceId);

  // delivery -> order mapping from outbound_delivery_items
  const tracedLines = [];
  for (const it of invItems) {
    const refDel = it.referenceSdDocument ? String(it.referenceSdDocument) : null;
    const refDelItemInt = normalizeItemInt(it.referenceSdDocumentItem);
    const delItemKey = refDel && refDelItemInt !== null ? `${refDel}:${refDelItemInt}` : null;
    const delItem = delItemKey ? deliveryItemsByKey.get(delItemKey) : null;

    const so = delItem?.referenceSdDocument ? String(delItem.referenceSdDocument) : null;
    const soItemInt = normalizeItemInt(delItem?.referenceSdDocumentItem);
    const soItemKey = so && soItemInt !== null ? `${so}:${soItemInt}` : null;
    const soItem = soItemKey ? orderItemByKey.get(soItemKey) : null;
    const soHeader = so ? orderById.get(so) : null;
    const custId = soHeader?.soldToParty ? String(soHeader.soldToParty) : invHeader?.soldToParty ? String(invHeader.soldToParty) : null;
    const cust = custId ? customerById.get(custId) : null;

    tracedLines.push({
      invoiceLine: {
        billingDocumentItem: it.billingDocumentItem,
        material: it.material || null,
        productName: it.material ? productNameById.get(String(it.material)) || null : null,
        billingQuantity: it.billingQuantity || null,
        netAmount: toNumber(it.netAmount)
      },
      delivery: refDel ? { deliveryDocument: refDel, deliveryDocumentItem: it.referenceSdDocumentItem } : null,
      salesOrder: so ? { salesOrder: so, salesOrderItem: delItem?.referenceSdDocumentItem || null } : null,
      customer: cust
        ? { businessPartner: cust.businessPartner, name: cust.businessPartnerFullName || cust.businessPartnerName || null }
        : custId
          ? { businessPartner: custId, name: null }
          : null
    });
  }

  const je = journalByInvoice.get(invoiceId) || [];
  const paymentsForInvoice = je
    .map((x) => paymentByKey.get(`${x.companyCode}:${x.fiscalYear}:${x.accountingDocument}:${x.accountingDocumentItem}`))
    .filter(Boolean);

  const q2 = {
    billingDocument: invoiceId,
    generatedQuery: `// Cypher (Neo4j)
MATCH (i:Invoice {entityId:$billingDocument})
OPTIONAL MATCH (i)-[:HAS_LINE]->(il:InvoiceLine)
OPTIONAL MATCH (il)-[:CHARGES]->(dl:DeliveryLine)-[:FULFILLS]->(ol:OrderLine)<-[:HAS_LINE]-(o:Order)<-[:PLACED]-(c:Customer)
OPTIONAL MATCH (p:Payment)-[:APPLIED_TO]->(i)
RETURN i, collect(DISTINCT il) AS invoiceLines,
       collect(DISTINCT dl) AS deliveryLines,
       collect(DISTINCT ol) AS orderLines,
       o, c,
       collect(DISTINCT p) AS payments
LIMIT 50`,
    executionResult: {
      invoiceHeader: compact
        ? invHeader
          ? {
              billingDocument: invHeader.billingDocument,
              billingDocumentDate: invHeader.billingDocumentDate,
              billingDocumentIsCancelled: invHeader.billingDocumentIsCancelled,
              soldToParty: invHeader.soldToParty,
              companyCode: invHeader.companyCode,
              fiscalYear: invHeader.fiscalYear,
              accountingDocument: invHeader.accountingDocument,
              totalNetAmount: invHeader.totalNetAmount,
              transactionCurrency: invHeader.transactionCurrency
            }
          : null
        : invHeader,
      lineTrace: compact ? tracedLines.slice(0, 4) : tracedLines.slice(0, 20),
      journalEntryItemsCount: je.length,
      paymentsCount: paymentsForInvoice.length,
      paymentsSample: paymentsForInvoice.slice(0, compact ? 1 : 5)
    },
    finalResponse: (() => {
      const custs = tracedLines.map((x) => x.customer?.businessPartner).filter(Boolean);
      const custUnique = Array.from(new Set(custs));
      const soIds = tracedLines.map((x) => x.salesOrder?.salesOrder).filter(Boolean);
      const soUnique = Array.from(new Set(soIds));
      const delIds = tracedLines.map((x) => x.delivery?.deliveryDocument).filter(Boolean);
      const delUnique = Array.from(new Set(delIds));
      const paid = paymentsForInvoice.length > 0;
      return `Billing document ${invoiceId} has ${invItems.length} invoice line(s), references ${delUnique.length} delivery document(s), and traces back to ${soUnique.length} sales order(s). ` +
        (custUnique.length ? `Customer(s): ${custUnique.join(", ")}. ` : "") +
        (paid ? `Found ${paymentsForInvoice.length} payment clearing record(s).` : "No payment clearing records found for this billing document in the dataset.");
    })()
  };

  // -------------------------
  // (3) Find incomplete flows
  const allOrderLineKeys = new Set();
  for (const oi of orderItems) {
    const so = String(oi.salesOrder);
    const itemInt = normalizeItemInt(oi.salesOrderItem);
    if (itemInt === null) continue;
    allOrderLineKeys.add(`${so}:${itemInt}`);
  }

  const deliveredOrderLineKeys = new Set();
  for (const di of deliveryItems) {
    const so = di.referenceSdDocument ? String(di.referenceSdDocument) : null;
    const itemInt = normalizeItemInt(di.referenceSdDocumentItem);
    if (!so || itemInt === null) continue;
    deliveredOrderLineKeys.add(`${so}:${itemInt}`);
  }

  const billedDeliveryLineKeys = new Set();
  for (const bi of invoiceItems) {
    const del = bi.referenceSdDocument ? String(bi.referenceSdDocument) : null;
    const itemInt = normalizeItemInt(bi.referenceSdDocumentItem);
    if (!del || itemInt === null) continue;
    billedDeliveryLineKeys.add(`${del}:${itemInt}`);
  }

  const billedOrderLineKeys = new Set();
  for (const di of deliveryItems) {
    const delId = String(di.deliveryDocument);
    const delItemInt = normalizeItemInt(di.deliveryDocumentItem);
    if (delItemInt === null) continue;
    const delKey = `${delId}:${delItemInt}`;
    if (!billedDeliveryLineKeys.has(delKey)) continue;
    const so = di.referenceSdDocument ? String(di.referenceSdDocument) : null;
    const soItemInt = normalizeItemInt(di.referenceSdDocumentItem);
    if (!so || soItemInt === null) continue;
    billedOrderLineKeys.add(`${so}:${soItemInt}`);
  }

  const invoiceIds = invoiceHeaders.map((x) => String(x.billingDocument));
  const paidInvoiceIds = new Set();
  for (const [invId, jes] of journalByInvoice.entries()) {
    const hasPayment = jes.some((x) =>
      paymentByKey.has(`${x.companyCode}:${x.fiscalYear}:${x.accountingDocument}:${x.accountingDocumentItem}`)
    );
    if (hasPayment) paidInvoiceIds.add(invId);
  }

  const undelivered = Array.from(allOrderLineKeys).filter((k) => !deliveredOrderLineKeys.has(k));
  const deliveredNotBilled = Array.from(deliveredOrderLineKeys).filter((k) => !billedOrderLineKeys.has(k));
  const unpaidInvoices = invoiceIds.filter((id) => !paidInvoiceIds.has(id));

  const q3 = {
    generatedQuery: `// Cypher (Neo4j) examples
// A) Order lines with no delivery
MATCH (ol:OrderLine)<-[:HAS_LINE]-(o:Order)
WHERE NOT EXISTS { MATCH (:DeliveryLine)-[:FULFILLS]->(ol) }
RETURN o.entityId AS orderId, ol.entityId AS orderLineId
LIMIT 25

// B) Delivered but not billed
MATCH (dl:DeliveryLine)-[:FULFILLS]->(ol:OrderLine)
WHERE NOT EXISTS { MATCH (:InvoiceLine)-[:CHARGES]->(dl) }
RETURN dl.entityId AS deliveryLineId, ol.entityId AS orderLineId
LIMIT 25

// C) Invoices with no payments applied
MATCH (i:Invoice)
WHERE NOT EXISTS { MATCH (:Payment)-[:APPLIED_TO]->(i) }
RETURN i.entityId AS invoiceId
LIMIT 25`,
    executionResult: {
      totalOrderLines: allOrderLineKeys.size,
      undeliveredOrderLinesCount: undelivered.length,
      deliveredNotBilledOrderLinesCount: deliveredNotBilled.length,
      totalInvoices: invoiceIds.length,
      unpaidInvoicesCount: unpaidInvoices.length,
      samples: {
        undeliveredOrderLines: undelivered.slice(0, 10),
        deliveredNotBilledOrderLines: deliveredNotBilled.slice(0, 10),
        unpaidInvoices: unpaidInvoices.slice(0, 10)
      }
    },
    finalResponse:
      `Incomplete flows found: ${undelivered.length} / ${allOrderLineKeys.size} order lines have no delivery; ` +
      `${deliveredNotBilled.length} delivered order lines are not billed; ` +
      `${unpaidInvoices.length} / ${invoiceIds.length} invoices have no payment clearing record in the dataset.`
  };

  const out = {
    note:
      "These results are computed directly from the uploaded JSONL dataset files (data-backed). The 'generatedQuery' fields show the equivalent Cypher you can run once Neo4j is loaded.",
    queries: {
      q1_productsHighestBillingDocuments: q1,
      q2_traceBillingDocumentFlow: q2,
      q3_incompleteFlows: q3
    }
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
