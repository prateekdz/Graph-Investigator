const { extractIntent, extractIdCandidate } = require("./intentExtractor");

function nowMs() {
  return Date.now();
}

function safeString(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function primaryIdForNode(node) {
  if (!node) return null;
  const type = node.type;
  const f = node.fields || {};
  if (type === "Invoice") return f.billingDocument || null;
  if (type === "Order") return f.salesOrder || null;
  if (type === "Delivery") return f.deliveryDocument || null;
  if (type === "Customer") return f.businessPartner || f.customer || null;
  if (type === "JournalEntry") return f.accountingDocument || null;
  if (type === "Payment") return f.accountingDocument || null;
  if (type === "Product") return f.product || null;
  return null;
}

function entityTypeCandidates(entity, id) {
  // File-backed node types.
  if (entity) return [entity];
  const candidates = [];
  if (id && /^\d{9}$/.test(id)) candidates.push("Customer");
  if (id && /^\d{6}$/.test(id)) candidates.push("Order");
  if (id && /^\d{8}$/.test(id)) candidates.push("Invoice", "Delivery");
  if (id && /^\d{10,12}$/.test(id)) candidates.push("JournalEntry", "Payment");
  return candidates.length
    ? candidates
    : ["Invoice", "Order", "Delivery", "JournalEntry", "Payment", "Customer", "Product"];
}

function scoreNodeMatch(node, { entity, id }) {
  if (!node) return 0;
  const text = JSON.stringify(node.fields || {});
  let score = 0;
  if (entity && node.type === entity) score += 5;
  if (id) {
    if (node.id.endsWith(`:${id}`)) score += 6;
    if (safeString(primaryIdForNode(node)) === id) score += 6;
    if (text.includes(id)) score += 2;
  }
  if (node.primary) score += 0.5;
  return score;
}

function bestNode(nodes, intent) {
  let best = null;
  let bestScore = -1;
  for (const n of nodes) {
    const s = scoreNodeMatch(n, intent);
    if (s > bestScore) {
      bestScore = s;
      best = n;
    }
  }
  return bestScore >= 4 ? best : null;
}

function formatHighlights(text, tokens) {
  let out = String(text || "");
  for (const t of tokens || []) {
    if (!t) continue;
    out = out.replaceAll(String(t), `**${t}**`);
  }
  return out;
}

function buildAnswer({ question, intent, mainNode, neighbors }) {
  if (!mainNode) {
    return "I couldn’t find an exact matching record in the dataset. Try including an entity type (invoice/order/delivery/journal/payment/customer/product) and an id.";
  }

  const q = String(question || "").toLowerCase();
  const wantsJournal = q.includes("journal");
  const wantsPayment = q.includes("payment");

  const id = primaryIdForNode(mainNode) || (mainNode.id.includes(":") ? mainNode.id.split(":").slice(1).join(":") : mainNode.id);
  // Example target behavior (from the reference UI): "Find the journal entry linked to billing document <id>"
  if (wantsJournal && mainNode.type === "Invoice") {
    const journal = (neighbors || []).find((n) => n?.type === "JournalEntry");
    const jeNum = journal?.fields?.accountingDocument ? String(journal.fields.accountingDocument) : null;
    if (jeNum) {
      return formatHighlights(`The journal entry number linked to invoice ${id} is ${jeNum}.`, [id, jeNum]);
    }
    return formatHighlights(`No journal entry found linked to invoice ${id} in the dataset.`, [id]);
  }

  if (wantsPayment && mainNode.type === "Invoice") {
    const payment = (neighbors || []).find((n) => n?.type === "Payment");
    const pNum = payment?.fields?.accountingDocument ? String(payment.fields.accountingDocument) : null;
    if (pNum) {
      return formatHighlights(`Found a payment clearing invoice ${id}: ${pNum}.`, [id, pNum]);
    }
  }

  const relatedTypes = new Map();
  for (const n of neighbors || []) relatedTypes.set(n.type, (relatedTypes.get(n.type) || 0) + 1);
  const summary = Array.from(relatedTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, c]) => `${t} (${c})`)
    .join(", ");

  let sentence = `Found ${mainNode.type} ${id}.`;
  if (mainNode.type === "JournalEntry") {
    const ref = mainNode.fields?.referenceDocument;
    if (ref) sentence += ` ReferenceDocument: ${ref}.`;
  }
  if (mainNode.type === "Invoice") {
    const soldTo = mainNode.fields?.soldToParty;
    if (soldTo) sentence += ` SoldToParty: ${soldTo}.`;
  }
  if (summary) sentence += ` Related: ${summary}.`;

  const tokens = [intent?.id, extractIdCandidate(sentence)].filter(Boolean);
  return formatHighlights(sentence, tokens);
}

async function search({ q, graphStore, guardQuestion }) {
  const start = nowMs();
  const question = String(q || "").trim();
  const guard = guardQuestion(question);
  if (!guard.allowed) {
    return {
      rejected: true,
      message: guard.message,
      metadata: { ms: nowMs() - start }
    };
  }

  const intent = await extractIntent(question);
  const id = intent.id || extractIdCandidate(question);
  const entityCandidates = entityTypeCandidates(intent.entity, id);

  // Try direct id mapping first.
  const directCandidates = [];
  for (const t of entityCandidates) {
    if (!id) continue;
    const node = graphStore.nodesById.get(`${t}:${id}`);
    if (node) directCandidates.push(node);
  }

  // If no direct id, search by token within candidate types.
  let pool = directCandidates;
  if (pool.length === 0 && id) {
    for (const t of entityCandidates) {
      pool = pool.concat(graphStore.entitiesByType(t).filter((n) => JSON.stringify(n.fields || {}).includes(id)));
    }
  }
  if (pool.length === 0 && id) pool = graphStore.findByToken(id);

  const mainNode = bestNode(pool, { entity: intent.entity, id });

  if (!mainNode) {
    return {
      rejected: false,
      found: false,
      intent: { ...intent, id: id || null },
      message: "No exact record found in the dataset for that query.",
      metadata: { ms: nowMs() - start }
    };
  }

  const subgraph = graphStore.subgraphAround([mainNode.id], 2, 260);
  const details = graphStore.entityById(mainNode.id);
  const answer = buildAnswer({
    question,
    intent: { ...intent, id },
    mainNode: details?.node || mainNode,
    neighbors: details?.neighbors || []
  });

  return {
    rejected: false,
    found: true,
    answer,
    intent: { ...intent, id: id || null },
    mainNode: details?.node || mainNode,
    connections: details?.neighbors || [],
    edges: details?.edges || [],
    subgraph,
    highlights: [mainNode.id],
    metadata: {
      ms: nowMs() - start,
      candidateTypes: entityCandidates,
      intentSource: intent.source,
      intentConfidence: intent.confidence
    }
  };
}

module.exports = { search };
