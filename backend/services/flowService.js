const PRIMARY_FLOW_TYPES = new Set([
  "Customer",
  "Order",
  "Delivery",
  "Invoice",
  "Payment",
  "JournalEntry"
]);

function buildEdgeIndex(graphStore) {
  const out = new Map(); // id -> edges[]
  const into = new Map(); // id -> edges[]

  for (const e of graphStore.edges || []) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!into.has(e.target)) into.set(e.target, []);
    out.get(e.source).push(e);
    into.get(e.target).push(e);
  }

  return { out, into };
}

function getEdgeIndex(graphStore) {
  // cache on the store instance
  if (graphStore.__flowEdgeIndex && graphStore.__flowEdgeIndexEdges === graphStore.edges) {
    return graphStore.__flowEdgeIndex;
  }
  const idx = buildEdgeIndex(graphStore);
  graphStore.__flowEdgeIndex = idx;
  graphStore.__flowEdgeIndexEdges = graphStore.edges;
  return idx;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function uniqById(nodes) {
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    if (!n || !n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

function pickBest(nodes) {
  const list = uniqById(asArray(nodes));
  if (list.length === 0) return null;
  list.sort((a, b) => {
    const dc = (b.connections || 0) - (a.connections || 0);
    if (dc !== 0) return dc;
    return String(a.id).localeCompare(String(b.id));
  });
  return list[0] || null;
}

function linkedNodes({ graphStore, idx, fromId, relationship, direction, type }) {
  const edges = direction === "in" ? idx.into.get(fromId) : idx.out.get(fromId);
  const matches = [];
  for (const e of edges || []) {
    if (relationship && e.relationship !== relationship) continue;
    const otherId = direction === "in" ? e.source : e.target;
    const n = graphStore.nodesById.get(otherId);
    if (!n) continue;
    if (type && n.type !== type) continue;
    matches.push(n);
  }
  return matches;
}

function promoteToHeader({ graphStore, idx, node }) {
  if (!node) return null;
  if (PRIMARY_FLOW_TYPES.has(node.type)) return node;

  // Promote common *Item -> header via incoming HAS_ITEM
  if (String(node.type || "").endsWith("Item")) {
    const parents = linkedNodes({
      graphStore,
      idx,
      fromId: node.id,
      relationship: "HAS_ITEM",
      direction: "in"
    });
    const header = parents.find((p) => PRIMARY_FLOW_TYPES.has(p.type));
    if (header) return header;
    return parents[0] || node;
  }

  return node;
}

function resolveStartNode(graphStore, rawId) {
  const id = String(rawId || "").trim();
  if (!id) return { node: null, resolvedId: null };

  if (graphStore.nodesById.has(id)) return { node: graphStore.nodesById.get(id), resolvedId: id };

  // Prefer primary flow types (works for inputs like "90504248")
  const primaryCandidates = ["Order", "Invoice", "Delivery", "Customer", "JournalEntry", "Payment"];
  for (const t of primaryCandidates) {
    const full = `${t}:${id}`;
    if (graphStore.nodesById.has(full)) return { node: graphStore.nodesById.get(full), resolvedId: full };
  }

  // Fallback: token scan (restricted to primary-ish nodes to keep it deterministic)
  const hits = graphStore.findByToken(id).filter((n) => PRIMARY_FLOW_TYPES.has(n.type));
  return { node: pickBest(hits), resolvedId: pickBest(hits)?.id || null };
}

function salesOrderFromDelivery({ graphStore, idx, delivery }) {
  if (!delivery) return null;

  const deliveryItems = linkedNodes({
    graphStore,
    idx,
    fromId: delivery.id,
    relationship: "HAS_ITEM",
    direction: "out"
  }).filter((n) => n.type === "DeliveryItem");

  const soItems = uniqById(
    deliveryItems.flatMap((di) =>
      linkedNodes({ graphStore, idx, fromId: di.id, relationship: "FULFILLS", direction: "out", type: "OrderItem" })
    )
  );

  const salesOrders = uniqById(
    soItems.flatMap((soi) =>
      linkedNodes({ graphStore, idx, fromId: soi.id, relationship: "HAS_ITEM", direction: "in", type: "Order" })
    )
  );

  return pickBest(salesOrders);
}

function deliveryFromSalesOrder({ graphStore, idx, salesOrder }) {
  if (!salesOrder) return null;
  const soItems = linkedNodes({
    graphStore,
    idx,
    fromId: salesOrder.id,
    relationship: "HAS_ITEM",
    direction: "out"
  }).filter((n) => n.type === "OrderItem");

  const deliveryItems = uniqById(
    soItems.flatMap((soi) =>
      linkedNodes({ graphStore, idx, fromId: soi.id, relationship: "FULFILLS", direction: "in", type: "DeliveryItem" })
    )
  );

  const deliveries = uniqById(
    deliveryItems.flatMap((di) =>
      linkedNodes({ graphStore, idx, fromId: di.id, relationship: "HAS_ITEM", direction: "in", type: "Delivery" })
    )
  );

  return pickBest(deliveries);
}

function invoiceFromDelivery({ graphStore, idx, delivery }) {
  if (!delivery) return null;
  const deliveryItems = linkedNodes({
    graphStore,
    idx,
    fromId: delivery.id,
    relationship: "HAS_ITEM",
    direction: "out"
  }).filter((n) => n.type === "DeliveryItem");

  const billingItems = uniqById(
    deliveryItems.flatMap((di) =>
      linkedNodes({ graphStore, idx, fromId: di.id, relationship: "BILLS", direction: "in", type: "InvoiceItem" })
    )
  );

  const invoices = uniqById(
    billingItems.flatMap((bi) =>
      linkedNodes({ graphStore, idx, fromId: bi.id, relationship: "HAS_ITEM", direction: "in", type: "Invoice" })
    )
  );

  return pickBest(invoices);
}

function deliveryFromInvoice({ graphStore, idx, invoice }) {
  if (!invoice) return null;
  const billingItems = linkedNodes({
    graphStore,
    idx,
    fromId: invoice.id,
    relationship: "HAS_ITEM",
    direction: "out"
  }).filter((n) => n.type === "InvoiceItem");

  const deliveryItems = uniqById(
    billingItems.flatMap((bi) =>
      linkedNodes({ graphStore, idx, fromId: bi.id, relationship: "BILLS", direction: "out", type: "DeliveryItem" })
    )
  );

  const deliveries = uniqById(
    deliveryItems.flatMap((di) =>
      linkedNodes({ graphStore, idx, fromId: di.id, relationship: "HAS_ITEM", direction: "in", type: "Delivery" })
    )
  );

  return pickBest(deliveries);
}

function journalFromInvoice({ graphStore, idx, invoice }) {
  if (!invoice) return null;
  const journals = linkedNodes({
    graphStore,
    idx,
    fromId: invoice.id,
    relationship: "AR_FOR",
    direction: "in",
    type: "JournalEntry"
  });
  return pickBest(journals);
}

function invoiceFromJournal({ graphStore, idx, journal }) {
  if (!journal) return null;
  const invoices = linkedNodes({
    graphStore,
    idx,
    fromId: journal.id,
    relationship: "AR_FOR",
    direction: "out",
    type: "Invoice"
  });
  return pickBest(invoices);
}

function paymentFromJournal({ graphStore, idx, journal }) {
  if (!journal) return null;
  const payments = linkedNodes({
    graphStore,
    idx,
    fromId: journal.id,
    relationship: "CLEARS",
    direction: "in",
    type: "Payment"
  });
  return pickBest(payments);
}

function journalFromPayment({ graphStore, idx, payment }) {
  if (!payment) return null;
  const journals = linkedNodes({
    graphStore,
    idx,
    fromId: payment.id,
    relationship: "CLEARS",
    direction: "out",
    type: "JournalEntry"
  });
  return pickBest(journals);
}

function customerFromOrder({ graphStore, idx, salesOrder }) {
  if (!salesOrder) return null;
  const customers = linkedNodes({
    graphStore,
    idx,
    fromId: salesOrder.id,
    relationship: "PLACED",
    direction: "in",
    type: "Customer"
  });
  return pickBest(customers);
}

function customerFromInvoice({ graphStore, idx, invoice }) {
  if (!invoice) return null;
  const customers = linkedNodes({
    graphStore,
    idx,
    fromId: invoice.id,
    relationship: "BILLED",
    direction: "in",
    type: "Customer"
  });
  return pickBest(customers);
}

function pickFirstOrderForCustomer({ graphStore, idx, customer }) {
  if (!customer) return null;
  const orders = linkedNodes({
    graphStore,
    idx,
    fromId: customer.id,
    relationship: "PLACED",
    direction: "out",
    type: "Order"
  });
  return pickBest(orders);
}

function statusForStep(node) {
  if (!node) return "missing";
  if (node.type === "Invoice" && node.fields?.billingDocumentIsCancelled) return "error";
  return "completed";
}

function stepPayload(node) {
  if (!node) return null;
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    status: statusForStep(node),
    fields: node.fields || {}
  };
}

function neo4jReferenceCypher() {
  // For teams that later back this endpoint with Neo4j instead of the in-memory graph.
  // Supports partial flows via OPTIONAL MATCH.
  return (
    "MATCH (n) WHERE n.id = $id OR n.salesOrder = $id OR n.billingDocument = $id OR n.deliveryDocument = $id\n" +
    "OPTIONAL MATCH (c:Customer)-[:PLACED]->(o:SalesOrder)\n" +
    "WHERE (n:SalesOrder AND o.salesOrder = $id) OR (n:Customer AND c.businessPartner = $id) OR id(o)=id(n)\n" +
    "OPTIONAL MATCH (o)<-[:HAS_ITEM]-(:SalesOrderItem)<-[:FULFILLS]-(:DeliveryItem)<-[:HAS_ITEM]-(d:Delivery)\n" +
    "OPTIONAL MATCH (d)-[:HAS_ITEM]->(:DeliveryItem)<-[:BILLS]-(:BillingDocumentItem)<-[:HAS_ITEM]-(i:BillingDocument)\n" +
    "OPTIONAL MATCH (i)<-[:AR_FOR]-(j:JournalEntry)\n" +
    "OPTIONAL MATCH (p:Payment)-[:CLEARS]->(j)\n" +
    "RETURN c, o, d, i, p, j"
  );
}

function buildFlow({ graphStore, rawId }) {
  const idx = getEdgeIndex(graphStore);
  const { node: resolved, resolvedId } = resolveStartNode(graphStore, rawId);
  const start = promoteToHeader({ graphStore, idx, node: resolved });
  if (!start) {
    return { found: false, flow: null, meta: { resolvedId: resolvedId || null, neo4jCypher: neo4jReferenceCypher() } };
  }

  let customer = null;
  let order = null;
  let delivery = null;
  let invoice = null;
  let payment = null;
  let journalEntry = null;

  if (start.type === "Customer") {
    customer = start;
    order = pickFirstOrderForCustomer({ graphStore, idx, customer });
  } else if (start.type === "Order") {
    order = start;
  } else if (start.type === "Delivery") {
    delivery = start;
    order = salesOrderFromDelivery({ graphStore, idx, delivery });
  } else if (start.type === "Invoice") {
    invoice = start;
    delivery = deliveryFromInvoice({ graphStore, idx, invoice });
    order = salesOrderFromDelivery({ graphStore, idx, delivery });
  } else if (start.type === "JournalEntry") {
    journalEntry = start;
    invoice = invoiceFromJournal({ graphStore, idx, journalEntry });
    delivery = deliveryFromInvoice({ graphStore, idx, invoice });
    order = salesOrderFromDelivery({ graphStore, idx, delivery });
  } else if (start.type === "Payment") {
    payment = start;
    journalEntry = journalFromPayment({ graphStore, idx, payment });
    invoice = invoiceFromJournal({ graphStore, idx, journalEntry });
    delivery = deliveryFromInvoice({ graphStore, idx, invoice });
    order = salesOrderFromDelivery({ graphStore, idx, delivery });
  }

  // forward-derive missing steps if we have earlier docs
  if (!delivery && order) delivery = deliveryFromSalesOrder({ graphStore, idx, salesOrder: order });
  if (!invoice && delivery) invoice = invoiceFromDelivery({ graphStore, idx, delivery });
  if (!journalEntry && invoice) journalEntry = journalFromInvoice({ graphStore, idx, invoice });
  if (!payment && journalEntry) payment = paymentFromJournal({ graphStore, idx, journalEntry });

  // customer can be derived from order or invoice
  if (!customer && order) customer = customerFromOrder({ graphStore, idx, salesOrder: order });
  if (!customer && invoice) customer = customerFromInvoice({ graphStore, idx, invoice });
  if (!customer && start.type === "Customer") customer = start;

  const flow = {
    customer: stepPayload(customer),
    order: stepPayload(order),
    delivery: stepPayload(delivery),
    invoice: stepPayload(invoice),
    payment: stepPayload(payment),
    journalEntry: stepPayload(journalEntry),
    meta: {
      start: { id: start.id, type: start.type },
      resolvedId: resolvedId || start.id,
      neo4jCypher: neo4jReferenceCypher()
    }
  };

  return { found: true, flow };
}

module.exports = { buildFlow, resolveStartNode };
