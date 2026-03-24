const path = require("node:path");
const fs = require("node:fs");
const { loadDatasetFiles } = require("./dataParser");

function normalizeItemInt(value) {
  if (value === null || value === undefined) return null;
  const n = Number.parseInt(String(value).replace(/^0+/, "") || "0", 10);
  return Number.isFinite(n) ? n : null;
}

const ENTITY_MAP = {
  business_partners: { type: "Customer", pk: (r) => String(r.businessPartner || r.customer) },
  business_partner_addresses: { type: "Address", pk: (r) => String(r.addressUuid || r.addressId) },
  products: { type: "Product", pk: (r) => String(r.product) },
  product_descriptions: { type: "ProductDescription", pk: (r) => `${String(r.product)}:${String(r.language)}` },
  sales_order_headers: { type: "Order", pk: (r) => String(r.salesOrder) },
  sales_order_items: {
    type: "OrderItem",
    pk: (r) => `${String(r.salesOrder)}:${normalizeItemInt(r.salesOrderItem)}`
  },
  outbound_delivery_headers: { type: "Delivery", pk: (r) => String(r.deliveryDocument) },
  outbound_delivery_items: {
    type: "DeliveryItem",
    pk: (r) => `${String(r.deliveryDocument)}:${normalizeItemInt(r.deliveryDocumentItem)}`
  },
  billing_document_headers: { type: "Invoice", pk: (r) => String(r.billingDocument) },
  billing_document_items: {
    type: "InvoiceItem",
    pk: (r) => `${String(r.billingDocument)}:${normalizeItemInt(r.billingDocumentItem)}`
  },
  journal_entry_items_accounts_receivable: {
    type: "JournalEntry",
    pk: (r) =>
      `${String(r.companyCode)}:${String(r.fiscalYear)}:${String(r.accountingDocument)}:${String(r.accountingDocumentItem)}`
  },
  payments_accounts_receivable: {
    type: "Payment",
    pk: (r) =>
      `${String(r.companyCode)}:${String(r.fiscalYear)}:${String(r.accountingDocument)}:${String(r.accountingDocumentItem)}`
  }
};

function isPrimaryType(type) {
  return new Set(["JournalEntry", "Order", "Invoice", "Delivery", "Customer", "Payment"]).has(type);
}

function nodeColor(type, isPrimary) {
  if (isPrimary) return "#60a5fa";
  if (type === "Product" || type === "Address") return "#E57373";
  return "#f87171";
}

function labelFor(type, fields) {
  if (type === "Customer") return fields.businessPartnerFullName || fields.businessPartnerName || "Customer";
  if (type === "Product") return fields.productDescription || fields.productOldId || "Product";
  if (type === "Invoice") return `Invoice ${fields.billingDocument}`;
  if (type === "Order") return `Order ${fields.salesOrder}`;
  if (type === "Delivery") return `Delivery ${fields.deliveryDocument}`;
  if (type === "JournalEntry") return `Journal ${fields.accountingDocument}`;
  return type;
}

function pickFields(fields, limit = 18) {
  const entries = Object.entries(fields || {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const obj = {};
  for (const [k, v] of entries) obj[k] = v;
  return { fields: obj, hasMore: entries.length > limit };
}

function buildEdges({ nodesByType }) {
  const edges = [];

  const get = (type) => nodesByType.get(type) || [];
  const byId = (type) => {
    const m = new Map();
    for (const n of get(type)) m.set(n.key, n);
    return m;
  };

  const customers = byId("Customer");
  const products = byId("Product");
  const orders = byId("Order");
  const orderItems = byId("OrderItem");
  const deliveries = byId("Delivery");
  const deliveryItems = byId("DeliveryItem");
  const invoices = byId("Invoice");
  const invoiceItems = byId("InvoiceItem");
  const journals = byId("JournalEntry");
  const payments = byId("Payment");

  // Header -> item edges
  for (const it of get("OrderItem")) {
    const o = orders.get(String(it.fields.salesOrder));
    if (o) edges.push({ source: o.id, target: it.id, relationship: "HAS_ITEM" });
    if (it.fields.material && products.has(String(it.fields.material))) {
      edges.push({ source: it.id, target: products.get(String(it.fields.material)).id, relationship: "MATERIAL" });
    }
  }

  for (const it of get("DeliveryItem")) {
    const d = deliveries.get(String(it.fields.deliveryDocument));
    if (d) edges.push({ source: d.id, target: it.id, relationship: "HAS_ITEM" });

    const so = it.fields.referenceSdDocument ? String(it.fields.referenceSdDocument) : null;
    const soItemInt = normalizeItemInt(it.fields.referenceSdDocumentItem);
    if (so && soItemInt !== null) {
      const key = `${so}:${soItemInt}`;
      const oi = orderItems.get(key);
      if (oi) edges.push({ source: it.id, target: oi.id, relationship: "FULFILLS" });
    }
  }

  for (const it of get("InvoiceItem")) {
    const b = invoices.get(String(it.fields.billingDocument));
    if (b) edges.push({ source: b.id, target: it.id, relationship: "HAS_ITEM" });

    if (it.fields.material && products.has(String(it.fields.material))) {
      edges.push({ source: it.id, target: products.get(String(it.fields.material)).id, relationship: "MATERIAL" });
    }

    const del = it.fields.referenceSdDocument ? String(it.fields.referenceSdDocument) : null;
    const delItemInt = normalizeItemInt(it.fields.referenceSdDocumentItem);
    if (del && delItemInt !== null) {
      const key = `${del}:${delItemInt}`;
      const di = deliveryItems.get(key);
      if (di) edges.push({ source: it.id, target: di.id, relationship: "BILLS" });
    }
  }

  // Customer relationships
  for (const so of get("Order")) {
    const custId = so.fields.soldToParty ? String(so.fields.soldToParty) : null;
    if (custId && customers.has(custId)) edges.push({ source: customers.get(custId).id, target: so.id, relationship: "PLACED" });
  }
  for (const inv of get("Invoice")) {
    const custId = inv.fields.soldToParty ? String(inv.fields.soldToParty) : null;
    if (custId && customers.has(custId))
      edges.push({ source: customers.get(custId).id, target: inv.id, relationship: "BILLED" });
  }

  // Journal -> billing doc
  for (const je of get("JournalEntry")) {
    const ref = je.fields.referenceDocument ? String(je.fields.referenceDocument) : null;
    if (ref && invoices.has(ref)) edges.push({ source: je.id, target: invoices.get(ref).id, relationship: "AR_FOR" });
  }

  // Payment clears journal entry (same composite key)
  for (const p of get("Payment")) {
    if (journals.has(p.key)) edges.push({ source: p.id, target: journals.get(p.key).id, relationship: "CLEARS" });
  }

  return edges;
}

function buildGraphFromRows(byEntityKey) {
  const nodes = [];
  const nodesById = new Map();
  const nodesByType = new Map();

  for (const [entityKey, rows] of byEntityKey.entries()) {
    const spec = ENTITY_MAP[entityKey];
    if (!spec) continue;

    const type = spec.type;
    for (const r of rows) {
      const pk = spec.pk(r);
      if (!pk || pk.includes("null")) continue;
      const id = `${type}:${pk}`;
      if (nodesById.has(id)) continue;

      const primary = isPrimaryType(type);
      const picked = pickFields(r, 18);
      const node = {
        id,
        label: labelFor(type, r),
        type,
        fields: picked.fields,
        hasMoreFields: picked.hasMore,
        primary,
        color: nodeColor(type, primary)
      };

      nodesById.set(id, node);
      nodes.push(node);
      if (!nodesByType.has(type)) nodesByType.set(type, []);
      nodesByType.get(type).push({ ...node, key: pk });
    }
  }

  const edges = buildEdges({ nodesByType });

  // connection counts
  const degree = new Map();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  for (const n of nodes) n.connections = degree.get(n.id) || 0;

  return { nodes, edges };
}

async function buildGraphFromDataDir(dataDir) {
  const byEntityKey = await loadDatasetFiles(dataDir);

  // Enrich product descriptions into products (for nicer labels/fields)
  const prodDesc = byEntityKey.get("product_descriptions") || [];
  const prodMap = new Map();
  for (const p of byEntityKey.get("products") || []) prodMap.set(String(p.product), p);
  for (const d of prodDesc) {
    if (d.language === "EN" && d.product && prodMap.has(String(d.product))) {
      prodMap.get(String(d.product)).productDescription = d.productDescription;
    }
  }

  return buildGraphFromRows(byEntityKey);
}

function dirLooksLikeSapO2C(dirPath) {
  try {
    const required = [
      "sales_order_headers",
      "sales_order_items",
      "outbound_delivery_headers",
      "outbound_delivery_items",
      "billing_document_headers",
      "billing_document_items",
      "business_partners",
      "payments_accounts_receivable"
    ];
    return required.every((d) => fs.existsSync(path.join(dirPath, d)));
  } catch {
    return false;
  }
}

function findSapO2CDir(rootDir, maxDepth = 4) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (dirLooksLikeSapO2C(dir)) return dir;
    if (depth >= maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const next = path.join(dir, e.name);
      queue.push({ dir: next, depth: depth + 1 });
    }
  }
  return null;
}

function defaultDataDir() {
  // default to the provided dataset path in this repo
  return path.resolve(__dirname, "..", "..", "data", "sap-order-to-cash", "sap-o2c-data");
}

function resolveDataDir(inputDir) {
  const candidate = inputDir || defaultDataDir();
  if (dirLooksLikeSapO2C(candidate)) return candidate;
  const found = findSapO2CDir(candidate);
  return found || candidate;
}

module.exports = { buildGraphFromDataDir, defaultDataDir, resolveDataDir };
